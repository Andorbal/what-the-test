import { ParsedTestFile, SetupRegion, TestDeclaration } from '../../core/types';
import { LineIndex, findMatchingBracket } from '../text';
import { maskGo } from './goMask';

/** testify suite methods that run around every test of the suite. */
const TESTIFY_SETUP = new Set([
  'SetupSuite', 'TearDownSuite', 'SetupTest', 'TearDownTest', 'SetupSubTest', 'TearDownSubTest', 'BeforeTest', 'AfterTest',
]);

interface Func {
  receiver?: string;
  name: string;
  nameStart: number;
  start: number;
  bodyStart: number;
  end: number;
}

/**
 * Finds tests in a Go `_test.go` file: `TestXxx`, `BenchmarkXxx`, `FuzzXxx`
 * and `ExampleXxx` functions, subtests declared with `t.Run("name", ...)`
 * (with a literal name), and testify suite methods.
 *
 * Subtest names are rewritten the way `go test` reports them (spaces become
 * underscores), since that is what test IDs contain.
 */
export function parseGoTests(text: string): ParsedTestFile {
  const masked = maskGo(text);
  const lines = new LineIndex(text);
  const declarations: TestDeclaration[] = [];
  const setupRegions: SetupRegion[] = [];
  const suites = new Map<string, { start: number; end: number; nameStart: number }>();

  const extendSuite = (receiver: string, start: number, end: number) => {
    const suite = suites.get(receiver);
    suites.set(receiver, suite
      ? { start: Math.min(suite.start, start), end: Math.max(suite.end, end), nameStart: suite.nameStart }
      : { start, end, nameStart: start });
  };

  const funcs = findFuncs(masked);
  for (const fn of funcs) {
    if (fn.receiver && TESTIFY_SETUP.has(fn.name)) {
      setupRegions.push({ range: lines.rangeAt(fn.start, fn.end) });
      extendSuite(fn.receiver, fn.start, fn.end);
      continue;
    }
    const isTest = fn.receiver ? /^Test(?![a-z])/.test(fn.name) : isTopLevelTest(fn.name);
    if (!isTest) {
      continue;
    }
    const path = fn.receiver ? [fn.receiver, fn.name] : [fn.name];
    declarations.push({
      kind: 'test',
      name: fn.name,
      path,
      range: lines.rangeAt(fn.start, fn.end),
      nameRange: lines.rangeAt(fn.nameStart, fn.nameStart + fn.name.length),
    });
    declarations.push(...findSubtests(text, masked, lines, fn.bodyStart, fn.end, path));
    if (fn.receiver) {
      extendSuite(fn.receiver, fn.start, fn.end);
    }
  }

  for (const [receiver, span] of suites) {
    if (!declarations.some(d => d.path[0] === receiver)) {
      continue; // only setup methods, no tests
    }
    // Include the suite's type declaration when it is in this file.
    const type = new RegExp(`^type\\s+(${receiver})\\b`, 'm').exec(masked);
    const start = type ? Math.min(type.index, span.start) : span.start;
    const end = type ? Math.max(span.end, typeEnd(masked, type.index)) : span.end;
    const nameStart = type ? type.index + type[0].length - receiver.length : span.nameStart;
    declarations.push({
      kind: 'suite',
      name: receiver,
      path: [receiver],
      range: lines.rangeAt(start, end),
      nameRange: lines.rangeAt(nameStart, nameStart + (type ? receiver.length : 0)),
    });
  }

  declarations.sort((a, b) => a.range.start.line - b.range.start.line || a.range.start.character - b.range.start.character);
  return { declarations, setupRegions };
}

/** `TestXxx`, `BenchmarkXxx`, `FuzzXxx`, `ExampleXxx` where Xxx doesn't start with a lower-case letter. */
function isTopLevelTest(name: string): boolean {
  return /^(?:Test|Benchmark|Fuzz|Example)(?![a-z])/.test(name) && name !== 'TestMain';
}

/** Top-level function and method declarations with a body. */
function findFuncs(masked: string): Func[] {
  const funcs: Func[] = [];
  const pattern = /^func[ \t]*(?:\(\s*(?:[A-Za-z_]\w*\s+)?\*?\s*([A-Za-z_]\w*)(?:\[[^\]]*\])?\s*\)\s*)?([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*\(/gm;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(masked))) {
    const paramsOpen = m.index + m[0].length - 1;
    const paramsClose = findMatchingBracket(masked, paramsOpen);
    if (paramsClose === -1) {
      continue;
    }
    // Skip the result types, which may contain parentheses, up to the body.
    let depth = 0;
    let bodyStart = -1;
    for (let i = paramsClose + 1; i < masked.length; i++) {
      const ch = masked[i];
      if (ch === '(' || ch === '[') {
        depth++;
      } else if (ch === ')' || ch === ']') {
        depth--;
      } else if (ch === '{' && depth === 0) {
        bodyStart = i;
        break;
      } else if (ch === '\n' && depth === 0 && !/[,(]\s*$/.test(masked.slice(paramsClose, i))) {
        break; // a declaration without a body
      }
    }
    if (bodyStart === -1) {
      continue;
    }
    const bodyEnd = findMatchingBracket(masked, bodyStart);
    const end = bodyEnd === -1 ? masked.length : bodyEnd + 1;
    funcs.push({ receiver: m[1], name: m[2], nameStart: m.index + m[0].lastIndexOf(m[2], m[0].length - 1), start: m.index, bodyStart, end });
    pattern.lastIndex = end;
  }
  return funcs;
}

/** `x.Run("name", func(...) { ... })` calls between `from` and `to`, recursively. */
function findSubtests(text: string, masked: string, lines: LineIndex, from: number, to: number, parentPath: string[]): TestDeclaration[] {
  const result: TestDeclaration[] = [];
  const pattern = /\b[A-Za-z_]\w*\.Run\(\s*(["`])/g;
  pattern.lastIndex = from;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(masked)) && m.index < to) {
    const open = m.index + m[0].indexOf('(');
    const close = findMatchingBracket(masked, open);
    const quote = m.index + m[0].length - 1;
    const endQuote = masked.indexOf(m[1], quote + 1);
    if (close === -1 || endQuote === -1 || !/^\s*,\s*func\s*\(/.test(masked.slice(endQuote + 1, endQuote + 40))) {
      continue;
    }
    const literal = text.slice(quote + 1, endQuote);
    const name = (m[1] === '"' ? unescape(literal) : literal).replace(/\s/g, '_');
    const path = [...parentPath, name];
    result.push({
      kind: 'test',
      name,
      path,
      range: lines.rangeAt(m.index, close + 1),
      nameRange: lines.rangeAt(quote + 1, endQuote),
    });
    result.push(...findSubtests(text, masked, lines, endQuote, close, path));
    pattern.lastIndex = close + 1;
  }
  return result;
}

function unescape(literal: string): string {
  try {
    return JSON.parse(`"${literal}"`) as string;
  } catch {
    return literal;
  }
}

/** End of a `type X struct { ... }` (or other type) declaration. */
function typeEnd(masked: string, start: number): number {
  const brace = masked.indexOf('{', start);
  const newline = masked.indexOf('\n', start);
  if (brace !== -1 && (newline === -1 || brace < newline)) {
    const close = findMatchingBracket(masked, brace);
    return close === -1 ? masked.length : close + 1;
  }
  return newline === -1 ? masked.length : newline;
}
