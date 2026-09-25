import * as vscode from 'vscode';
import { AdapterRegistry } from './core/adapterRegistry';
import { CoveringTest, CoveringTestFinder, LineTestsResult } from './core/coveringTestFinder';
import { LanguageAdapter } from './core/languageAdapter';
import { RunMode, TestingBridge } from './core/testingBridge';
import { builtInAdapters } from './languages';
import { LineIndicators } from './ui/indicators';
import { LineTestsService } from './ui/lineTestsService';
import { showLineTestsQuickPick } from './ui/lineTestsQuickPick';
import { LineTestsTreeView } from './ui/lineTestsTreeView';

/** API exported to other extensions, e.g. to add support for more languages. */
export interface WhatTheTestApi {
  registerLanguageAdapter(adapter: LanguageAdapter): vscode.Disposable;
  /** Finds the tests covering a line of a document. */
  findTestsForLine(document: vscode.TextDocument, line: number, token?: vscode.CancellationToken): Promise<LineTestsResult>;
}

export function activate(context: vscode.ExtensionContext): WhatTheTestApi {
  const log = vscode.window.createOutputChannel('What the Test');
  const registry = new AdapterRegistry();
  for (const adapter of builtInAdapters()) {
    context.subscriptions.push(registry.register(adapter));
  }

  const finder = new CoveringTestFinder(registry);
  const bridge = new TestingBridge(log);
  const service = new LineTestsService(registry, finder);
  context.subscriptions.push(log, registry, service, new LineIndicators(service), new LineTestsTreeView(service));

  /** The result for the active line, computing it if the cached one is stale. */
  const currentResult = async (): Promise<LineTestsResult | undefined> => {
    const editor = vscode.window.activeTextEditor;
    const state = service.state;
    if (editor && state.status === 'ready' &&
      state.result.uri.toString() === editor.document.uri.toString() && state.result.line === editor.selection.active.line) {
      return state.result;
    }
    return vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: 'Finding covering tests' },
      () => service.refreshNow(),
    );
  };

  /** Commands receive a test from the tree view, or a key from a command link. */
  const toTest = (arg: unknown): CoveringTest | undefined =>
    typeof arg === 'string' ? service.testByKey(arg) : (arg as CoveringTest | undefined);

  const runAll = async (mode: RunMode) => {
    const result = await currentResult();
    if (!result) {
      return;
    }
    if (!result.tests.length) {
      void vscode.window.showInformationMessage(`No tests found that cover line ${result.line + 1}.`);
      return;
    }
    await bridge.run(result.tests, mode);
  };

  const runOne = async (arg: unknown, mode: RunMode) => {
    const test = toTest(arg);
    if (test) {
      await bridge.run([test], mode);
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('whatTheTest.showTestsForLine', async () => {
      const result = await currentResult();
      if (result) {
        await showLineTestsQuickPick(result, bridge);
      }
    }),
    vscode.commands.registerCommand('whatTheTest.runTestsForLine', () => runAll('run')),
    vscode.commands.registerCommand('whatTheTest.debugTestsForLine', () => runAll('debug')),
    vscode.commands.registerCommand('whatTheTest.refresh', () => service.refreshNow()),
    vscode.commands.registerCommand('whatTheTest.runTest', (arg: unknown) => runOne(arg, 'run')),
    vscode.commands.registerCommand('whatTheTest.debugTest', (arg: unknown) => runOne(arg, 'debug')),
    vscode.commands.registerCommand('whatTheTest.goToTest', async (arg: unknown) => {
      const test = toTest(arg);
      if (test) {
        await bridge.reveal(test);
      }
    }),
  );

  return {
    registerLanguageAdapter: adapter => {
      const disposable = registry.register(adapter);
      context.subscriptions.push(disposable);
      return disposable;
    },
    findTestsForLine: (document, line, token) => {
      const config = vscode.workspace.getConfiguration('whatTheTest');
      return finder.findTestsForLine(document, line, {
        maxDepth: config.get<number>('maxSearchDepth', 8),
        maxVisited: config.get<number>('maxVisitedSymbols', 400),
      }, token ?? new vscode.CancellationTokenSource().token);
    },
  };
}

export function deactivate(): void {
  // Everything is disposed through context.subscriptions.
}
