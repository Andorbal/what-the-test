import * as vscode from 'vscode';
import { AdapterRegistry } from '../core/adapterRegistry';
import { ChangedCode, savedText, uncommittedChanges } from '../core/changedCode';
import { ChangedTestsResult, findTestsForChanges } from '../core/changedTests';
import { CoveringTest, CoveringTestFinder, FinderOptions } from '../core/coveringTestFinder';
import { changedLines } from '../core/lineDiff';
import { RunMode, TestingBridge } from '../core/testingBridge';
import { covers, pluralTests } from './format';
import { showTestsQuickPick } from './lineTestsQuickPick';

/**
 * "Show / Run Tests Covering Changes": finds the tests that reach code changed
 * since the last commit (including unsaved edits), and optionally runs the
 * tests covering each save.
 */
export class ChangedTestsCommands implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  /** For documents edited since they were last saved: their text as saved. */
  private readonly savedTexts = new Map<string, Promise<string | undefined>>();
  /** Saves waiting to have their tests run, by document. */
  private readonly queued = new Map<string, ChangedCode>();
  private draining = false;

  constructor(
    private readonly registry: AdapterRegistry,
    private readonly finder: CoveringTestFinder,
    private readonly bridge: TestingBridge,
    private readonly log: vscode.OutputChannel,
  ) {
    this.disposables.push(
      vscode.commands.registerCommand('whatTheTest.showTestsForChanges', () => this.show()),
      vscode.commands.registerCommand('whatTheTest.runTestsForChanges', () => this.run('run')),
      vscode.commands.registerCommand('whatTheTest.debugTestsForChanges', () => this.run('debug')),
      vscode.workspace.onDidChangeTextDocument(e => this.onDidChange(e)),
      vscode.workspace.onDidSaveTextDocument(document => void this.onDidSave(document)),
      vscode.workspace.onDidCloseTextDocument(document => this.savedTexts.delete(document.uri.toString())),
    );
  }

  /** Finds the tests covering uncommitted changes; undefined if cancelled. */
  async find(): Promise<ChangedTestsResult | undefined> {
    return vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Finding tests covering your changes', cancellable: true },
      async (progress, token) => {
        const changes = await uncommittedChanges(document => this.isSupported(document));
        if (token.isCancellationRequested) {
          return undefined;
        }
        let reported = 0;
        const result = await findTestsForChanges(this.finder, this.registry, changes, this.options(), token, (done, total) => {
          progress.report({ message: `${done + 1}/${total} changed symbols`, increment: ((done + 1 - reported) / total) * 100 });
          reported = done + 1;
        });
        this.log.appendLine(`Changes in ${changes.length} file(s), ${result.changedSymbols} symbol(s): ${pluralTests(result.tests.length)}` +
          `${result.truncated ? ' (search limit reached)' : ''}`);
        return token.isCancellationRequested ? undefined : result;
      },
    );
  }

  private async show(): Promise<void> {
    const result = await this.find();
    if (!result) {
      return;
    }
    if (!result.tests.length) {
      void vscode.window.showInformationMessage(noTestsMessage(result));
      return;
    }
    const count = result.tests.length;
    const title = `${pluralTests(count)}${result.truncated ? '+' : ''} ${covers(count)} your changes`;
    await showTestsQuickPick(result.tests, title, test => reachDescription(result, test), this.bridge);
  }

  private async run(mode: RunMode): Promise<void> {
    const result = await this.find();
    if (!result) {
      return;
    }
    if (!result.tests.length) {
      void vscode.window.showInformationMessage(noTestsMessage(result));
      return;
    }
    await this.bridge.run(result.tests, mode);
  }

  private onDidChange(e: vscode.TextDocumentChangeEvent): void {
    const key = e.document.uri.toString();
    // The file on disk still holds the last save until the next one, so read it on the first edit.
    if (e.contentChanges.length && !this.savedTexts.has(key) && this.runOnSave && e.document.uri.scheme === 'file' &&
      this.isSupported(e.document)) {
      this.savedTexts.set(key, savedText(e.document.uri));
    }
  }

  private async onDidSave(document: vscode.TextDocument): Promise<void> {
    const key = document.uri.toString();
    const before = this.savedTexts.get(key);
    this.savedTexts.delete(key);
    const text = document.getText();
    const old = await before;
    if (old === undefined || !this.runOnSave) {
      return;
    }
    const lines = changedLines(old, text);
    if (!lines.length) {
      return;
    }
    const queued = this.queued.get(key);
    this.queued.set(key, { document, lines: queued ? [...new Set([...queued.lines, ...lines])].sort((a, b) => a - b) : lines });
    if (!this.draining) {
      void this.drain();
    }
  }

  /** Runs the tests for queued saves, one batch at a time. */
  private async drain(): Promise<void> {
    this.draining = true;
    try {
      while (this.queued.size) {
        const changes = [...this.queued.values()];
        this.queued.clear();
        const cts = new vscode.CancellationTokenSource();
        try {
          const result = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Window, title: 'Finding tests covering the saved changes' },
            () => findTestsForChanges(this.finder, this.registry, changes, this.options(), cts.token),
          );
          const files = changes.map(c => vscode.workspace.asRelativePath(c.document.uri)).join(', ');
          this.log.appendLine(`Saved ${files}: ${pluralTests(result.tests.length)} ${covers(result.tests.length)} the changes`);
          if (result.tests.length) {
            await this.bridge.run(result.tests, 'run', { moveCursor: false });
          }
        } finally {
          cts.dispose();
        }
      }
    } catch (err) {
      this.log.appendLine(`Could not run the tests for saved changes: ${err}`);
    } finally {
      this.draining = false;
    }
  }

  private get runOnSave(): boolean {
    return vscode.workspace.getConfiguration('whatTheTest').get<boolean>('runTestsOnSave', false);
  }

  private isSupported(document: vscode.TextDocument): boolean {
    return !!this.registry.forDocument(document) && !!vscode.workspace.getWorkspaceFolder(document.uri);
  }

  private options(): FinderOptions {
    const config = vscode.workspace.getConfiguration('whatTheTest');
    return {
      maxDepth: config.get<number>('maxSearchDepth', 8),
      maxVisited: config.get<number>('maxVisitedSymbols', 400),
    };
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

function noTestsMessage(result: ChangedTestsResult): string {
  return result.changedSymbols
    ? `No tests found that cover your changes (${result.changedSymbols} changed ${result.changedSymbols === 1 ? 'symbol' : 'symbols'}).`
    : 'No uncommitted changes to code in a supported language.';
}

/** e.g. `changed` for a test that was edited, or `reaches add, sum`. */
function reachDescription(result: ChangedTestsResult, test: CoveringTest): string {
  const names = result.reaches.get(test.key) ?? [];
  return names.length ? `reaches ${names.join(', ')}` : 'changed';
}
