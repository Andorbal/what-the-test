import * as vscode from 'vscode';
import { AdapterRegistry } from '../core/adapterRegistry';
import { CoveringTest, CoveringTestFinder, LineTestsResult } from '../core/coveringTestFinder';
import { rangeContains } from '../core/types';

export type LineTestsState =
  | { status: 'idle' }
  | { status: 'loading'; uri: vscode.Uri; line: number }
  /**
   * `focus` is set when the cursor has moved into one of the result's tests:
   * the result is kept (rather than replaced by the test's own line) so the
   * user can go through the tests one by one.
   */
  | { status: 'ready'; result: LineTestsResult; focus?: CoveringTest };

const SUPPORTED_CONTEXT_KEY = 'whatTheTest.supportedEditor';
const PINNED_CONTEXT_KEY = 'whatTheTest.pinned';

/**
 * Tracks the cursor in the active editor and keeps the list of tests that
 * cover its line up to date. The UI (status bar, inline hint, tree view,
 * quick pick) renders whatever state this service publishes.
 *
 * The list doesn't follow the cursor while it is pinned, or while the cursor
 * is inside one of the listed tests.
 */
export class LineTestsService implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly stateEmitter = new vscode.EventEmitter<LineTestsState>();
  private currentState: LineTestsState = { status: 'idle' };
  private pending?: vscode.CancellationTokenSource;
  private timer?: NodeJS.Timeout;
  /** Set when cached results may be out of date, forcing a recompute even on the same line. */
  private dirty = true;
  private isPinned = false;
  /** Tests from recent results, by key, so commands can be invoked with just a key. */
  private readonly knownTests = new Map<string, CoveringTest>();

  readonly onDidChangeState = this.stateEmitter.event;

  constructor(private readonly registry: AdapterRegistry, private readonly finder: CoveringTestFinder) {
    this.disposables.push(
      this.stateEmitter,
      vscode.window.onDidChangeActiveTextEditor(() => this.schedule()),
      vscode.window.onDidChangeTextEditorSelection(e => {
        if (e.textEditor === vscode.window.activeTextEditor) {
          this.schedule();
        }
      }),
      vscode.workspace.onDidChangeTextDocument(e => {
        if (e.contentChanges.length && this.isSupported(e.document)) {
          this.invalidate();
        }
      }),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('whatTheTest')) {
          this.invalidate();
        }
      }),
      registry.onDidChange(() => this.invalidate()),
    );
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.{cs,fs,fsi,fsx,ts,tsx,mts,cts,js,jsx,mjs,cjs}');
    this.disposables.push(
      watcher,
      watcher.onDidCreate(() => this.invalidate()),
      watcher.onDidDelete(() => this.invalidate()),
      watcher.onDidChange(() => this.invalidate()),
    );
    void vscode.commands.executeCommand('setContext', PINNED_CONTEXT_KEY, false);
    this.schedule(0);
  }

  get state(): LineTestsState {
    return this.currentState;
  }

  get tests(): readonly CoveringTest[] {
    return this.currentState.status === 'ready' ? this.currentState.result.tests : [];
  }

  get pinned(): boolean {
    return this.isPinned;
  }

  /**
   * The result the UI is showing, when it is the one commands such as "Run
   * All" should act on: it is pinned, the cursor is inside one of its tests,
   * or it is for the cursor's line.
   */
  get displayedResult(): LineTestsResult | undefined {
    const state = this.currentState;
    if (state.status !== 'ready') {
      return undefined;
    }
    if (this.isPinned || state.focus) {
      return state.result;
    }
    const editor = vscode.window.activeTextEditor;
    return editor && state.result.uri.toString() === editor.document.uri.toString() &&
      state.result.line === editor.selection.active.line ? state.result : undefined;
  }

  testByKey(key: string): CoveringTest | undefined {
    return this.knownTests.get(key);
  }

  /** Stops (or resumes) following the cursor. Pinning does nothing until there is a result to pin. */
  setPinned(pinned: boolean): void {
    if (pinned === this.isPinned || (pinned && this.currentState.status === 'idle')) {
      return;
    }
    this.isPinned = pinned;
    void vscode.commands.executeCommand('setContext', PINNED_CONTEXT_KEY, pinned);
    if (pinned) {
      this.stateEmitter.fire(this.currentState);
    } else {
      this.dirty = true;
      this.schedule(0);
    }
  }

  /** Forgets cached results and recomputes for the current line. */
  invalidate(): void {
    this.dirty = true;
    this.finder.clearCache();
    this.schedule();
  }

  /**
   * Computes the tests for the active line now and returns them. With
   * `clearCache`, results cached from earlier searches are discarded first,
   * e.g. because the language server has finished indexing since.
   */
  async refreshNow(options: { clearCache?: boolean } = {}): Promise<LineTestsResult | undefined> {
    clearTimeout(this.timer);
    this.dirty = true;
    if (options.clearCache) {
      this.finder.clearCache();
    }
    await this.compute();
    return this.currentState.status === 'ready' ? this.currentState.result : undefined;
  }

  private isSupported(document: vscode.TextDocument): boolean {
    return !!this.registry.forDocument(document) && document.uri.scheme !== 'output';
  }

  private schedule(delay?: number): void {
    clearTimeout(this.timer);
    const debounce = delay ?? vscode.workspace.getConfiguration('whatTheTest').get<number>('debounceMs', 400);
    this.timer = setTimeout(() => void this.compute(), debounce);
  }

  private async compute(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const supported = !!editor && this.isSupported(editor.document);
    void vscode.commands.executeCommand('setContext', SUPPORTED_CONTEXT_KEY, supported);

    const current = this.currentState;
    // A pinned list only changes when the code changes; it is then recomputed for its own line.
    if (this.isPinned) {
      if (this.dirty && current.status !== 'idle') {
        this.dirty = false;
        await this.computeFor(await this.documentOf(current), lineOf(current));
      }
      return;
    }

    if (!editor || !supported) {
      this.cancelPending();
      this.setState({ status: 'idle' });
      return;
    }

    const { document } = editor;
    const line = editor.selection.active.line;
    if (current.status === 'ready') {
      const focus = this.listedTestAt(current.result, document.uri, line);
      if (focus && this.dirty) {
        // The code changed while going through the tests: refresh the list for its own line,
        // then check that the cursor is still inside one of them.
        this.dirty = false;
        if (await this.computeFor(await this.documentOf(current), current.result.line)) {
          await this.compute();
        }
        return;
      }
      if (focus) {
        if (focus !== current.focus) {
          this.setState({ status: 'ready', result: current.result, focus });
        }
        return;
      }
    }

    const sameLine = current.status !== 'idle' &&
      uriOf(current).toString() === document.uri.toString() && lineOf(current) === line;
    if (sameLine && !this.dirty) {
      if (current.status === 'ready' && current.focus) {
        this.setState({ status: 'ready', result: current.result });
      }
      return;
    }
    this.dirty = false;
    await this.computeFor(document, line);
  }

  /**
   * Finds the tests for a line and publishes them. Returns false if the
   * search was cancelled or the document couldn't be opened.
   */
  private async computeFor(document: vscode.TextDocument | undefined, line: number): Promise<boolean> {
    if (!document) {
      return false;
    }
    line = Math.min(line, document.lineCount - 1);
    this.cancelPending();

    const cts = new vscode.CancellationTokenSource();
    this.pending = cts;
    this.setState({ status: 'loading', uri: document.uri, line });

    const config = vscode.workspace.getConfiguration('whatTheTest');
    try {
      const result = await this.finder.findTestsForLine(document, line, {
        maxDepth: config.get<number>('maxSearchDepth', 8),
        maxVisited: config.get<number>('maxVisitedSymbols', 400),
      }, cts.token);
      if (cts.token.isCancellationRequested) {
        return false;
      }
      if (this.knownTests.size > 5000) {
        this.knownTests.clear();
      }
      for (const test of result.tests) {
        this.knownTests.set(test.key, test);
      }
      this.setState({ status: 'ready', result });
      return true;
    } catch (err) {
      if (cts.token.isCancellationRequested) {
        return false;
      }
      console.error('[what-the-test]', err);
      this.setState({ status: 'ready', result: { uri: document.uri, line, tests: [], truncated: false } });
      return true;
    }
  }

  /** The innermost listed test (or suite) whose declaration contains the line. */
  private listedTestAt(result: LineTestsResult, uri: vscode.Uri, line: number): CoveringTest | undefined {
    let best: CoveringTest | undefined;
    for (const test of result.tests) {
      const { range } = test.declaration;
      if (test.uri.toString() === uri.toString() && range.start.line <= line && line <= range.end.line &&
        (!best || rangeContains(best.declaration.range, range.start))) {
        best = test;
      }
    }
    return best;
  }

  private async documentOf(state: Exclude<LineTestsState, { status: 'idle' }>): Promise<vscode.TextDocument | undefined> {
    try {
      return await vscode.workspace.openTextDocument(uriOf(state));
    } catch {
      return undefined;
    }
  }

  private cancelPending(): void {
    this.pending?.cancel();
    this.pending?.dispose();
    this.pending = undefined;
  }

  private setState(state: LineTestsState): void {
    this.currentState = state;
    this.stateEmitter.fire(state);
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.cancelPending();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

function uriOf(state: Exclude<LineTestsState, { status: 'idle' }>): vscode.Uri {
  return state.status === 'ready' ? state.result.uri : state.uri;
}

function lineOf(state: Exclude<LineTestsState, { status: 'idle' }>): number {
  return state.status === 'ready' ? state.result.line : state.line;
}
