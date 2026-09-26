import * as vscode from 'vscode';
import { CoveringTest, LineTestsResult } from '../core/coveringTestFinder';
import { RunMode, TestingBridge } from '../core/testingBridge';
import { noTestsMessage, pluralTests, testLocation, testReach, testTitle } from './format';

interface TestPickItem extends vscode.QuickPickItem {
  test?: CoveringTest;
  runAll?: RunMode;
}

const RUN_BUTTON: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('run'), tooltip: 'Run Test' };
const DEBUG_BUTTON: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('debug-alt-small'), tooltip: 'Debug Test' };

/**
 * Lists the tests covering a line. Selecting a test opens it; the inline
 * buttons run or debug a single test; the top entries run all of them.
 */
export async function showLineTestsQuickPick(result: LineTestsResult, bridge: TestingBridge): Promise<void> {
  const count = result.tests.length;
  if (!count) {
    void vscode.window.showInformationMessage(noTestsMessage(result));
    return;
  }

  const items: TestPickItem[] = [
    { label: `$(run-all) Run all ${pluralTests(count)}`, runAll: 'run' },
    { label: `$(debug-alt) Debug all ${pluralTests(count)}`, runAll: 'debug' },
    { label: 'Tests', kind: vscode.QuickPickItemKind.Separator },
    ...result.tests.map((test): TestPickItem => ({
      label: `$(${test.declaration.kind === 'suite' ? 'symbol-namespace' : 'beaker'}) ${testTitle(test)}`,
      description: testLocation(test),
      detail: testReach(test),
      buttons: [RUN_BUTTON, DEBUG_BUTTON],
      test,
    })),
  ];

  const pick = vscode.window.createQuickPick<TestPickItem>();
  pick.title = `${pluralTests(count)}${result.truncated ? '+' : ''} cover line ${result.line + 1}${result.symbolName ? ` (${result.symbolName})` : ''}`;
  pick.placeholder = 'Select a test to open it, or use the buttons to run or debug it';
  pick.items = items;
  pick.matchOnDescription = true;

  let active: CoveringTest | undefined;
  pick.onDidChangeActive(([item]) => {
    // Preview the test while moving through the list.
    if (item?.test && item.test !== active) {
      active = item.test;
      void bridge.reveal(item.test, { preserveFocus: true });
    }
  });

  const originalEditor = vscode.window.activeTextEditor;
  const originalSelection = originalEditor?.selection;
  let action: (() => Promise<void>) | undefined;
  /** True once the user chose to open a test, so we shouldn't return to the original editor. */
  let navigated = false;

  await new Promise<void>(resolve => {
    pick.onDidTriggerItemButton(e => {
      const test = e.item.test;
      if (test) {
        action = () => bridge.run([test], e.button === DEBUG_BUTTON ? 'debug' : 'run');
        pick.hide();
      }
    });
    pick.onDidAccept(() => {
      const [item] = pick.selectedItems;
      const test = item?.test;
      const mode = item?.runAll;
      if (mode) {
        action = () => bridge.run(result.tests, mode);
      } else if (test) {
        navigated = true;
        action = () => bridge.reveal(test);
      }
      pick.hide();
    });
    pick.onDidHide(() => {
      pick.dispose();
      resolve();
    });
    pick.show();
  });

  // Return to where the user was if they previewed tests but didn't open one.
  if (!navigated && active && originalEditor && originalSelection) {
    await vscode.window.showTextDocument(originalEditor.document, { selection: originalSelection, viewColumn: originalEditor.viewColumn });
  }
  await action?.();
}
