import * as vscode from 'vscode';
import { CoveringTest } from './coveringTestFinder';
import { matchTestId } from './idMatching';

export type RunMode = 'run' | 'debug';

/** Mirrors VS Code's internal `TestRunProfileBitset`. */
const PROFILE_GROUP: Record<RunMode, number> = { run: 1 << 1, debug: 1 << 2 };
const AT_CURSOR_COMMAND: Record<RunMode, string> = { run: 'testing.runAtCursor', debug: 'testing.debugAtCursor' };
/** Delimiter VS Code uses between the segments of a test's ID. */
const TEST_ID_DELIMITER = '\0';

/**
 * Runs and reveals tests through VS Code's own Testing infrastructure (the
 * Test Explorer, C# Dev Kit, the Jest/Vitest/Mocha/Playwright extensions, ...)
 * rather than invoking test frameworks directly. Results therefore show up in
 * the Test Explorer, Test Results panel and editor gutters as usual.
 *
 * Tests are identified by asking VS Code which test items exist in a file
 * (`vscode.testing.getTestsInFile`) and matching them against the parsed
 * declaration. Matched tests are run together in a single run with
 * `vscode.runTestsById`. Tests that can't be matched (for controllers whose
 * IDs don't contain test names) are run by placing the cursor on them and
 * using VS Code's own "Run Test at Cursor" command.
 */
export class TestingBridge {
  constructor(private readonly log: vscode.OutputChannel) {}

  async run(tests: readonly CoveringTest[], mode: RunMode): Promise<void> {
    if (!tests.length) {
      return;
    }
    const resolved = await this.resolveIds(tests);
    const ids = [...new Set([...resolved.values()].filter((id): id is string => !!id))];
    const unresolved = tests.filter(t => !resolved.get(t));

    if (ids.length) {
      this.log.appendLine(`${mode} ${ids.length} test(s) by ID: ${ids.map(id => id.split(TEST_ID_DELIMITER).join(' › ')).join(', ')}`);
      await vscode.commands.executeCommand('vscode.runTestsById', PROFILE_GROUP[mode], ...ids);
    }
    if (unresolved.length) {
      await this.runAtLocations(unresolved, mode);
    }
  }

  /** Opens the test in the editor with its name selected. */
  async reveal(test: CoveringTest, options: { preserveFocus?: boolean } = {}): Promise<void> {
    const { start, end } = test.declaration.nameRange;
    await vscode.window.showTextDocument(test.uri, {
      selection: new vscode.Range(start.line, start.character, end.line, end.character),
      preserveFocus: options.preserveFocus,
    });
  }

  /** Maps each covering test to the full ID of a VS Code test item, when one can be found. */
  async resolveIds(tests: readonly CoveringTest[]): Promise<Map<CoveringTest, string | undefined>> {
    const result = new Map<CoveringTest, string | undefined>();
    const byFile = new Map<string, CoveringTest[]>();
    for (const test of tests) {
      const key = test.uri.toString();
      byFile.set(key, [...(byFile.get(key) ?? []), test]);
    }
    for (const fileTests of byFile.values()) {
      const candidates = await this.testIdsInFile(fileTests[0].uri);
      for (const test of fileTests) {
        const match = test.adapter.matchTestId
          ? test.adapter.matchTestId(test.declaration, candidates)
          : matchTestId(test.declaration, candidates);
        result.set(test, match?.join(TEST_ID_DELIMITER));
      }
    }
    return result;
  }

  private async testIdsInFile(uri: vscode.Uri): Promise<string[][]> {
    try {
      let ids = await vscode.commands.executeCommand<string[][]>('vscode.testing.getTestsInFile', uri);
      if (!ids?.length) {
        // Some controllers only discover tests once their file is opened.
        await vscode.workspace.openTextDocument(uri);
        ids = await vscode.commands.executeCommand<string[][]>('vscode.testing.getTestsInFile', uri);
      }
      return ids ?? [];
    } catch (err) {
      this.log.appendLine(`Could not list tests in ${uri.fsPath}: ${err}`);
      return [];
    }
  }

  /**
   * Runs each test with VS Code's "Run Test at Cursor", one at a time, then
   * restores the editor the user was in.
   */
  private async runAtLocations(tests: readonly CoveringTest[], mode: RunMode): Promise<void> {
    const previous = vscode.window.activeTextEditor;
    const previousSelection = previous?.selection;
    for (const test of tests) {
      this.log.appendLine(`${mode} "${test.declaration.path.join(' › ')}" at ${test.uri.fsPath}:${test.declaration.nameRange.start.line + 1}`);
      const { start } = test.declaration.nameRange;
      const editor = await vscode.window.showTextDocument(test.uri, {
        selection: new vscode.Range(start.line, start.character, start.line, start.character),
        preserveFocus: false,
      });
      editor.selection = new vscode.Selection(start.line, start.character, start.line, start.character);
      await vscode.commands.executeCommand(AT_CURSOR_COMMAND[mode]);
    }
    if (previous && previousSelection) {
      const editor = await vscode.window.showTextDocument(previous.document, { selection: previousSelection, viewColumn: previous.viewColumn });
      editor.revealRange(previousSelection);
    }
  }
}
