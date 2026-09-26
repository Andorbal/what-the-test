import * as vscode from 'vscode';
import { CoveringTest } from '../core/coveringTestFinder';
import { LineTestsService } from './lineTestsService';
import { covers, noTestsMessage, pluralTests, testIcon, testLocation, testReach, testTitle } from './format';

/** "Tests Covering Line" view in the Testing side bar. */
export class LineTestsTreeView implements vscode.TreeDataProvider<CoveringTest>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private readonly view: vscode.TreeView<CoveringTest>;
  private readonly disposables: vscode.Disposable[] = [];
  /** The tests currently shown, so moving between them doesn't rebuild the tree. */
  private shown: readonly CoveringTest[] | undefined;

  constructor(private readonly service: LineTestsService) {
    this.view = vscode.window.createTreeView('whatTheTest.lineTests', { treeDataProvider: this, showCollapseAll: false });
    this.disposables.push(this.view, this.changeEmitter, service.onDidChangeState(() => this.update()));
    this.update();
  }

  private update(): void {
    const state = this.service.state;
    const pin = this.service.pinned ? ' (pinned)' : '';
    if (state.status === 'loading') {
      this.view.message = `Finding tests that cover line ${state.line + 1}…`;
      this.view.description = undefined;
    } else if (state.status === 'ready') {
      const { result } = state;
      const file = vscode.workspace.asRelativePath(result.uri);
      this.view.description = `${file}:${result.line + 1}${pin}`;
      this.view.message = result.tests.length
        ? `${pluralTests(result.tests.length)}${result.truncated ? ' (search limit reached)' : ''} ${covers(result.tests.length)} line ${result.line + 1}${result.symbolName ? ` in ${result.symbolName}` : ''}.`
        : noTestsMessage(result);
    } else {
      this.view.message = undefined;
      this.view.description = undefined;
    }

    const tests = state.status === 'ready' ? state.result.tests : undefined;
    if (tests !== this.shown) {
      this.shown = tests;
      this.changeEmitter.fire();
    }
    if (state.status === 'ready' && state.focus && this.view.visible) {
      // Select the test the cursor is in, without taking focus from the editor.
      void Promise.resolve(this.view.reveal(state.focus, { select: true, focus: false })).catch(() => undefined);
    }
  }

  getChildren(element?: CoveringTest): CoveringTest[] {
    return element || !this.shown ? [] : [...this.shown];
  }

  getParent(): undefined {
    return undefined;
  }

  getTreeItem(test: CoveringTest): vscode.TreeItem {
    const item = new vscode.TreeItem(testTitle(test), vscode.TreeItemCollapsibleState.None);
    item.id = test.key;
    item.iconPath = testIcon(test);
    item.description = testLocation(test);
    item.tooltip = new vscode.MarkdownString(
      `**${test.declaration.path.join(' › ')}**${test.declaration.kind === 'suite' ? ' _(suite)_' : ''}\n\n` +
      `${testLocation(test)}\n\n${testReach(test)}`,
    );
    item.contextValue = 'coveringTest';
    item.command = { command: 'whatTheTest.goToTest', title: 'Go to Test', arguments: [test] };
    return item;
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
