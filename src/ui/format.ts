import * as vscode from 'vscode';
import { CoveringTest } from '../core/coveringTestFinder';

export function pluralTests(count: number): string {
  return `${count} ${count === 1 ? 'test' : 'tests'}`;
}

/** The verb that follows {@link pluralTests}: `1 test covers`, `2 tests cover`. */
export function covers(count: number): string {
  return count === 1 ? 'covers' : 'cover';
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
  if (test.distance === 0) {
    return 'line is inside this test';
  }
  if (!test.via.length) {
    return 'calls it directly';
  }
  return `via ${test.via.join(' → ')}`;
}

export function testIcon(test: CoveringTest): vscode.ThemeIcon {
  return new vscode.ThemeIcon(test.declaration.kind === 'suite' ? 'symbol-namespace' : 'beaker');
}
