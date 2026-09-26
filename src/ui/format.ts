import * as vscode from 'vscode';
import { CoveringTest, LineTestsResult } from '../core/coveringTestFinder';

export function pluralTests(count: number): string {
  return `${count} ${count === 1 ? 'test' : 'tests'}`;
}

/** Why a result has no tests, e.g. `Line 12 is part of the test 'adds two numbers'.` */
export function noTestsMessage(result: LineTestsResult): string {
  const test = result.enclosingTest;
  return test
    ? `Line ${result.line + 1} is part of the ${test.kind} '${test.name}'.`
    : `No tests found that cover line ${result.line + 1}.`;
}

/** e.g. `Calculator › add › adds two numbers` (without the namespace for C#). */
export function testTitle(test: CoveringTest): string {
  const path = test.declaration.path;
  const shown = test.adapter.id === 'csharp' ? path.slice(-2) : path;
  return shown.join(' › ');
}

export function testLocation(test: CoveringTest): string {
  return `${vscode.workspace.asRelativePath(test.uri)}:${test.declaration.nameRange.start.line + 1}`;
}

/** Describes how the test reaches the line, e.g. `directly` or `via parse → tokenize`. */
export function testReach(test: CoveringTest): string {
  if (!test.via.length) {
    return 'calls it directly';
  }
  return `via ${test.via.join(' → ')}`;
}

export function testIcon(test: CoveringTest): vscode.ThemeIcon {
  return new vscode.ThemeIcon(test.declaration.kind === 'suite' ? 'symbol-namespace' : 'beaker');
}
