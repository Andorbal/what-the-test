/**
 * Editor-independent types shared by the language parsers and the extension.
 * Nothing in this file (or in the parsers) may import `vscode`, so that the
 * parsing logic can be unit tested with plain Node.
 */

/** Zero-based line/character position, mirroring `vscode.Position`. */
export interface TextPosition {
  line: number;
  character: number;
}

/** Half-open range, mirroring `vscode.Range`. */
export interface TextRange {
  start: TextPosition;
  end: TextPosition;
}

export type DeclarationKind = 'test' | 'suite';

/** A test or suite found by statically parsing a test file. */
export interface TestDeclaration {
  kind: DeclarationKind;
  /** The test's own name, e.g. `Adds_two_numbers` or `adds two numbers`. */
  name: string;
  /**
   * Names of the enclosing containers followed by `name`, outermost first.
   * For C#: `[namespace, class, ..., method]`; for JS: `[describe, ..., it]`.
   */
  path: string[];
  /** Full extent of the declaration (attributes/call through closing brace). */
  range: TextRange;
  /** Range of the identifier/title that best represents the declaration. */
  nameRange: TextRange;
}

/**
 * A region of a test file that runs as part of every test in a suite
 * (`beforeEach`, `[SetUp]`, an xUnit constructor, ...).
 */
export interface SetupRegion {
  range: TextRange;
}

export interface ParsedTestFile {
  declarations: TestDeclaration[];
  setupRegions: SetupRegion[];
}

export function comparePositions(a: TextPosition, b: TextPosition): number {
  return a.line !== b.line ? a.line - b.line : a.character - b.character;
}

export function rangeContains(range: TextRange, pos: TextPosition): boolean {
  return comparePositions(range.start, pos) <= 0 && comparePositions(pos, range.end) <= 0;
}

export function rangeContainsRange(outer: TextRange, inner: TextRange): boolean {
  return rangeContains(outer, inner.start) && rangeContains(outer, inner.end);
}

/** The innermost declaration of the given kind that contains a position or range. */
export function innermostDeclaration(
  parsed: ParsedTestFile,
  kind: DeclarationKind,
  target: TextPosition | TextRange,
): TestDeclaration | undefined {
  let best: TestDeclaration | undefined;
  for (const d of parsed.declarations) {
    if (d.kind !== kind) {
      continue;
    }
    const contains = 'start' in target ? rangeContainsRange(d.range, target) : rangeContains(d.range, target);
    if (contains && (!best || rangeContainsRange(best.range, d.range))) {
      best = d;
    }
  }
  return best;
}

/**
 * Finds what a position inside a test file belongs to:
 *  - the innermost test declaration that contains it, or
 *  - if it is inside a setup region, the innermost suite containing that region.
 * Returns undefined for code that is neither (e.g. a helper function), in which
 * case callers should keep walking up the call graph.
 */
export function declarationAt(parsed: ParsedTestFile, pos: TextPosition): TestDeclaration | undefined {
  const test = innermostDeclaration(parsed, 'test', pos);
  if (test) {
    return test;
  }
  for (const region of parsed.setupRegions) {
    if (rangeContains(region.range, pos)) {
      return innermostDeclaration(parsed, 'suite', region.range);
    }
  }
  return undefined;
}
