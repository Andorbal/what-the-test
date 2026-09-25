import * as vscode from 'vscode';
import { AdapterRegistry } from '../core/adapterRegistry';
import { CoveringTest, CoveringTestFinder, LineTestsResult } from '../core/coveringTestFinder';

export type LineTestsState =
  | { status: 'idle' }
  | { status: 'loading'; uri: vscode.Uri; line: number }
  | { status: 'ready'; result: LineTestsResult };

const SUPPORTED_CONTEXT_KEY = 'whatTheTest.supportedEditor';

/**
 * Tracks the cursor in the active editor and keeps the list of tests that
 * cover its line up to date. The UI (status bar, inline hint, tree view,
 * quick pick) renders whatever state this service publishes.
 */
export class LineTestsService implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly stateEmitter = new vscode.EventEmitter<LineTestsState>();
  private currentState: LineTestsState = { status: 'idle' };
  private pending?: vscode.CancellationTokenSource;
  private timer?: NodeJS.Timeout;
  /** Set when cached results may be out of date, forcing a recompute even on the same line. */
  private dirty = true;
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
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.{cs,ts,tsx,mts,cts,js,jsx,mjs,cjs}');
    this.disposables.push(
      watcher,
      watcher.onDidCreate(() => this.invalidate()),
      watcher.onDidDelete(() => this.invalidate()),
      watcher.onDidChange(() => this.invalidate()),
    );
    this.schedule(0);
  }

  get state(): LineTestsState {
    return this.currentState;
  }

  get tests(): readonly CoveringTest[] {
    return this.currentState.status === 'ready' ? this.currentState.result.tests : [];
  }

  testByKey(key: string): CoveringTest | undefined {
    return this.knownTests.get(key);
  }

  /** Forgets cached results and recomputes for the current line. */
  invalidate(): void {
    this.dirty = true;
    this.finder.clearCache();
    this.schedule();
  }

  /** Computes the tests for the active line now and returns them. */
  async refreshNow(): Promise<LineTestsResult | undefined> {
    clearTimeout(this.timer);
    this.dirty = true;
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
    if (!editor || !supported) {
      this.cancelPending();
      this.setState({ status: 'idle' });
      return;
    }

    const { document } = editor;
    const line = editor.selection.active.line;
    const current = this.currentState;
    const sameLine = current.status !== 'idle' &&
      (current.status === 'ready' ? current.result : current).uri.toString() === document.uri.toString() &&
      (current.status === 'ready' ? current.result : current).line === line;
    if (sameLine && !this.dirty) {
      return;
    }
    this.dirty = false;
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
      if (!cts.token.isCancellationRequested) {
        if (this.knownTests.size > 5000) {
          this.knownTests.clear();
        }
        for (const test of result.tests) {
          this.knownTests.set(test.key, test);
        }
        this.setState({ status: 'ready', result });
      }
    } catch (err) {
      if (!cts.token.isCancellationRequested) {
        console.error('[what-the-test]', err);
        this.setState({ status: 'ready', result: { uri: document.uri, line, tests: [], truncated: false } });
      }
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
