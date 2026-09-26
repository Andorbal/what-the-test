import * as vscode from 'vscode';
import { AdapterRegistry } from './adapterRegistry';
import { ChangedCode } from './changedCode';
import { CoveringTest, CoveringTestFinder, FinderOptions } from './coveringTestFinder';
import { declarationAt } from './types';

export interface ChangedTestsResult {
  /** Tests that reach the changed code, plus tests whose own code changed. */
  readonly tests: readonly CoveringTest[];
  /** For each test (by key), the changed symbols it reaches; empty for a test whose own code changed. */
  readonly reaches: ReadonlyMap<string, readonly string[]>;
  /** Number of changed symbols (functions, methods, tests, ...) that were searched. */
  readonly changedSymbols: number;
  /** True when a search stopped early because it hit the configured limits. */
  readonly truncated: boolean;
}

/**
 * Finds the tests that exercise changed code. Changed lines are grouped by
 * the symbol (or test) that contains them, so each symbol's callers are
 * walked once. A change inside a test selects that test itself.
 */
export async function findTestsForChanges(
  finder: CoveringTestFinder,
  registry: AdapterRegistry,
  changes: readonly ChangedCode[],
  options: FinderOptions,
  token: vscode.CancellationToken,
  progress?: (done: number, total: number) => void,
): Promise<ChangedTestsResult> {
  const work: { document: vscode.TextDocument; line: number }[] = [];
  for (const { document, lines } of changes) {
    const testFile = registry.parseTestFile(document);
    const seen = new Set<string>();
    for (const line of lines) {
      if (token.isCancellationRequested) {
        break;
      }
      if (line >= document.lineCount) {
        continue; // edited again since the lines were computed
      }
      const text = document.lineAt(line);
      if (text.isEmptyOrWhitespace) {
        continue;
      }
      const position = new vscode.Position(line, text.firstNonWhitespaceCharacterIndex);
      const test = testFile && declarationAt(testFile.parsed, position);
      const symbol = test ? undefined : await finder.enclosingSymbol(document, position);
      const at = test?.range.start ?? symbol?.selectionRange.start;
      const key = at && `${test ? 'test' : 'symbol'}:${at.line}:${at.character}`;
      if (key && !seen.has(key)) {
        seen.add(key);
        work.push({ document, line });
      }
    }
  }

  const found = new Map<string, CoveringTest>();
  const reaches = new Map<string, string[]>();
  let truncated = false;
  for (const [index, { document, line }] of work.entries()) {
    if (token.isCancellationRequested) {
      break;
    }
    progress?.(index, work.length);
    const result = await finder.findTestsForLine(document, line, options, token);
    truncated ||= result.truncated;
    const enclosing = result.enclosingTest;
    const testFile = enclosing && registry.parseTestFile(document);
    if (enclosing && testFile) {
      const start = enclosing.range.start;
      const key = `${document.uri}#${start.line}:${start.character}`;
      found.set(key, { key, uri: document.uri, declaration: enclosing, adapter: testFile.adapter, distance: 0, via: [] });
      reaches.set(key, []);
      continue;
    }
    for (const test of result.tests) {
      const existing = found.get(test.key);
      if (!existing || existing.distance > test.distance) {
        found.set(test.key, test);
      }
      const names = reaches.get(test.key) ?? [];
      const name = result.symbolName ?? `line ${line + 1}`;
      if (existing?.distance !== 0 && !names.includes(name)) {
        reaches.set(test.key, [...names, name]);
      }
    }
  }

  const tests = [...found.values()].sort((a, b) =>
    a.uri.toString().localeCompare(b.uri.toString()) ||
    a.declaration.range.start.line - b.declaration.range.start.line);
  return { tests, reaches, changedSymbols: work.length, truncated };
}
