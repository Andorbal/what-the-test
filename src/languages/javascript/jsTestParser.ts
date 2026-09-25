import { ParsedTestFile, SetupRegion, TestDeclaration, rangeContainsRange } from '../../core/types';
import { LineIndex, findMatchingBracket, isIdentifierChar, skipWhitespace } from '../text';
import { maskJavaScript } from './jsMask';

export interface JsTestParserOptions {
  testFunctions?: readonly string[];
  suiteFunctions?: readonly string[];
  hookFunctions?: readonly string[];
}

/** Covers Jest, Vitest, Mocha (BDD + TDD), Jasmine, node:test, Bun and Playwright. */
export const DEFAULT_TEST_FUNCTIONS = ['it', 'test', 'specify', 'xit', 'fit', 'xtest', 'bench'];
export const DEFAULT_SUITE_FUNCTIONS = ['describe', 'context', 'suite', 'xdescribe', 'fdescribe', 'xcontext'];
export const DEFAULT_HOOK_FUNCTIONS = [
  'beforeEach', 'beforeAll', 'afterEach', 'afterAll', 'before', 'after',
  'setup', 'teardown', 'suiteSetup', 'suiteTeardown',
];

/** Modifiers that can be chained between the function name and the call. */
const MODIFIER_WITH_TABLE = new Set(['each', 'for']);
/** Chained members that make the call something other than a declaration. */
const NOT_A_DECLARATION = new Set(['step', 'use', 'extend', 'configure']);

interface RawCall {
  fn: string;
  kind: 'test' | 'suite' | 'hook';
  start: number;
  end: number;
  nameStart: number;
  nameEnd: number;
  name: string;
}

/** Statically finds test, suite and hook calls in a JS/TS test file. */
export function parseJavaScriptTests(text: string, options: JsTestParserOptions = {}): ParsedTestFile {
  const kinds = new Map<string, RawCall['kind']>();
  for (const fn of options.hookFunctions ?? DEFAULT_HOOK_FUNCTIONS) {
    kinds.set(fn, 'hook');
  }
  for (const fn of options.suiteFunctions ?? DEFAULT_SUITE_FUNCTIONS) {
    kinds.set(fn, 'suite');
  }
  for (const fn of options.testFunctions ?? DEFAULT_TEST_FUNCTIONS) {
    kinds.set(fn, 'test');
  }

  const masked = maskJavaScript(text);
  const lines = new LineIndex(text);
  const calls: RawCall[] = [];
  const identifier = /[A-Za-z_$][\w$]*/g;

  let m: RegExpExecArray | null;
  while ((m = identifier.exec(masked))) {
    const fn = m[0];
    const start = m.index;
    const kind = kinds.get(fn);
    if (!kind) {
      continue;
    }
    // `foo.it(...)` is a method on something else.
    if (start > 0 && masked[start - 1] === '.') {
      continue;
    }
    const call = readCall(text, masked, kinds, fn, kind, start);
    if (call) {
      calls.push(call);
      // Continue scanning inside the call so nested describes/its are found.
      identifier.lastIndex = call.nameEnd;
    }
  }

  const declarations: TestDeclaration[] = [];
  const setupRegions: SetupRegion[] = [];
  const suites: { range: TestDeclaration['range']; name: string }[] = [];

  for (const call of calls) {
    const range = lines.rangeAt(call.start, call.end);
    if (call.kind === 'hook') {
      setupRegions.push({ range });
      continue;
    }
    if (call.kind === 'suite') {
      suites.push({ range, name: call.name });
    }
    declarations.push({
      kind: call.kind,
      name: call.name,
      path: [],
      range,
      nameRange: lines.rangeAt(call.nameStart, call.nameEnd),
    });
  }

  // Calls are in source order, so containers always precede their contents.
  for (const decl of declarations) {
    const containers = suites.filter(s => s.range !== decl.range && rangeContainsRange(s.range, decl.range));
    decl.path = [...containers.map(s => s.name), decl.name];
  }

  return { declarations, setupRegions };
}

function readCall(
  text: string,
  masked: string,
  kinds: ReadonlyMap<string, RawCall['kind']>,
  fn: string,
  kind: RawCall['kind'],
  start: number,
): RawCall | undefined {
  let i = start + fn.length;
  if (isIdentifierChar(masked[i])) {
    return undefined;
  }

  // Chained modifiers: .only, .skip, .todo, .concurrent, .each(table), .each`table`
  for (;;) {
    const dot = skipWhitespace(masked, i);
    if (masked[dot] !== '.') {
      break;
    }
    const idStart = skipWhitespace(masked, dot + 1);
    let idEnd = idStart;
    while (isIdentifierChar(masked[idEnd])) {
      idEnd++;
    }
    if (idEnd === idStart) {
      return undefined;
    }
    i = idEnd;
    const modifier = masked.slice(idStart, idEnd);
    if (NOT_A_DECLARATION.has(modifier)) {
      return undefined;
    }
    // Playwright style: `test.describe(...)`, `test.beforeEach(...)`
    const chainedKind = kinds.get(modifier);
    if (chainedKind) {
      fn = modifier;
      kind = chainedKind;
    }
    if (MODIFIER_WITH_TABLE.has(modifier)) {
      const tableStart = skipTypeArguments(masked, skipWhitespace(masked, i));
      if (masked[tableStart] === '(') {
        const close = findMatchingBracket(masked, tableStart);
        if (close === -1) {
          return undefined;
        }
        i = close + 1;
      } else if (masked[tableStart] === '`') {
        const close = masked.indexOf('`', tableStart + 1);
        if (close === -1) {
          return undefined;
        }
        i = close + 1;
      }
    }
  }

  const open = skipTypeArguments(masked, skipWhitespace(masked, i));
  if (masked[open] !== '(') {
    return undefined;
  }
  const close = findMatchingBracket(masked, open);
  if (close === -1) {
    return undefined;
  }

  const argStart = skipWhitespace(masked, open + 1);
  let nameStart = argStart;
  let nameEnd = argStart;
  let name: string;
  const quote = masked[argStart];

  if (kind === 'hook') {
    nameStart = start;
    nameEnd = start + fn.length;
    name = fn;
  } else if (quote === '"' || quote === "'" || quote === '`') {
    const end = masked.indexOf(quote, argStart + 1);
    if (end === -1 || end > close) {
      return undefined;
    }
    nameStart = argStart + 1;
    nameEnd = end;
    name = unescape(text.slice(nameStart, nameEnd));
  } else {
    // A non-literal title such as `describe(MyClass, ...)` or `describe(MyClass.name, ...)`
    let j = argStart;
    while (j < close && masked[j] !== ',' && masked[j] !== '\n') {
      j++;
    }
    name = text.slice(argStart, j).trim().replace(/\.name$/, '');
    nameEnd = argStart + name.length;
    if (!/^[\w$.]+$/.test(name) || masked[j] !== ',') {
      // `it()` with no callback isn't a test we can do anything with.
      return undefined;
    }
  }

  return { fn, kind, start, end: close + 1, nameStart, nameEnd, name };
}

/** Skips optional TypeScript type arguments, e.g. the `<Case>` in `test.each<Case>(...)`. */
function skipTypeArguments(masked: string, offset: number): number {
  if (masked[offset] !== '<') {
    return offset;
  }
  let depth = 0;
  for (let i = offset; i < masked.length; i++) {
    if (masked[i] === '<') {
      depth++;
    } else if (masked[i] === '>') {
      depth--;
      if (depth === 0) {
        return skipWhitespace(masked, i + 1);
      }
    } else if (masked[i] === ';' || masked[i] === '{') {
      break;
    }
  }
  return offset;
}

function unescape(raw: string): string {
  return raw.replace(/\\(.)/g, '$1');
}
