import { ParsedTestFile, SetupRegion, TestDeclaration, rangeContainsRange } from '../../core/types';
import { DEFAULT_SETUP_ATTRIBUTES, DEFAULT_TEST_ATTRIBUTES } from '../csharp/csharpTestParser';
import { LineIndex, findMatchingBracket } from '../text';
import { maskFSharp } from './fsharpMask';

/** The .NET test attributes (xUnit, NUnit, MSTest, FsCheck, ...) apply to F# too. */
export const DEFAULT_FSHARP_TEST_ATTRIBUTES = DEFAULT_TEST_ATTRIBUTES;

/** Expecto functions that declare a test, each also with a `p` (pending) and `f` (focused) prefix. */
const EXPECTO_TESTS = [
  'test', 'testAsync', 'testTask', 'testCase', 'testCaseAsync', 'testCaseTask',
  'testProperty', 'testPropertyWithConfig', 'testPropertyWithConfigs',
  'testTheory', 'testTheoryAsync', 'testTheoryTask',
];
const EXPECTO_SUITES = ['testList'];
/** Members of an xUnit test class that run around every test (IAsyncLifetime / IDisposable). */
const LIFECYCLE_MEMBERS = new Set(['InitializeAsync', 'DisposeAsync', 'Dispose']);

export interface FSharpTestParserOptions {
  testAttributes?: readonly string[];
  setupAttributes?: readonly string[];
}

interface Container {
  kind: 'namespace' | 'module' | 'type';
  name: string;
  start: number;
  nameStart: number;
  end: number;
}

/** A `let` or `member` binding preceded by attributes. */
interface Binding {
  name: string;
  nameStart: number;
  start: number;
  end: number;
  attributes: string[];
}

/**
 * Finds tests in F# source: attributed `let` bindings in modules and members
 * in classes (xUnit, NUnit, MSTest, FsCheck), and Expecto's `testList` /
 * `testCase` / `test` declarations. F# nests code by indentation, so the
 * extent of a declaration is found with the offside rule.
 */
export function parseFSharpTests(text: string, options: FSharpTestParserOptions = {}): ParsedTestFile {
  const testAttributes = new Set(options.testAttributes ?? DEFAULT_FSHARP_TEST_ATTRIBUTES);
  const setupAttributes = new Set(options.setupAttributes ?? DEFAULT_SETUP_ATTRIBUTES);
  const source = new Source(text);
  const containers = findContainers(source);

  const pathFor = (offset: number) =>
    containers
      .filter(c => c.start < offset && offset <= c.end)
      .sort((a, b) => a.start - b.start)
      .flatMap(c => c.kind === 'module' && c.name.includes('.') ? splitModuleName(c.name) : [c.name]);

  const declarations: TestDeclaration[] = [];
  const setupRegions: SetupRegion[] = [];
  const containersWithTests = new Set<Container>();

  for (const binding of findAttributedBindings(source)) {
    const range = source.lines.rangeAt(binding.start, binding.end);
    if (binding.attributes.some(a => testAttributes.has(a))) {
      declarations.push({
        kind: 'test',
        name: binding.name,
        path: [...pathFor(binding.start), binding.name],
        range,
        nameRange: source.lines.rangeAt(binding.nameStart, binding.nameStart + binding.name.length),
      });
      const owner = innermost(containers.filter(c => c.kind !== 'namespace'), binding.start);
      if (owner) {
        containersWithTests.add(owner);
      }
    } else if (binding.attributes.some(a => setupAttributes.has(a))) {
      setupRegions.push({ range });
    }
  }

  for (const container of containersWithTests) {
    const name = container.name.split('.').pop()!;
    const nameStart = container.nameStart + container.name.length - name.length;
    declarations.push({
      kind: 'suite',
      name,
      path: pathFor(container.start + 1),
      range: source.lines.rangeAt(container.start, container.end),
      nameRange: source.lines.rangeAt(nameStart, nameStart + name.length),
    });
    if (container.kind === 'type') {
      for (const region of implicitSetup(source, container)) {
        setupRegions.push({ range: source.lines.rangeAt(region.start, region.end) });
      }
    }
  }

  declarations.push(...findExpectoTests(source));
  declarations.sort((a, b) => a.range.start.line - b.range.start.line || a.range.start.character - b.range.start.character);
  return { declarations, setupRegions };
}

/** `Calc.Tests.CalculatorTests` → `['Calc.Tests', 'CalculatorTests']`, like a namespace and a class. */
function splitModuleName(name: string): string[] {
  const dot = name.lastIndexOf('.');
  return [name.slice(0, dot), name.slice(dot + 1)];
}

function innermost(containers: Container[], offset: number): Container | undefined {
  let best: Container | undefined;
  for (const c of containers) {
    if (c.start < offset && offset <= c.end && (!best || c.start > best.start)) {
      best = c;
    }
  }
  return best;
}

/** Masked text with helpers for F#'s indentation-based structure. */
class Source {
  readonly masked: string;
  readonly lines: LineIndex;
  private readonly lineStarts: number[] = [0];

  constructor(readonly text: string) {
    this.masked = maskFSharp(text);
    this.lines = new LineIndex(text);
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) {
        this.lineStarts.push(i + 1);
      }
    }
  }

  get lineCount(): number {
    return this.lineStarts.length;
  }

  lineStart(line: number): number {
    return this.lineStarts[line];
  }

  lineEnd(line: number): number {
    const next = line + 1 < this.lineStarts.length ? this.lineStarts[line + 1] - 1 : this.masked.length;
    let end = next;
    while (end > this.lineStarts[line] && /\s/.test(this.masked[end - 1])) {
      end--;
    }
    return end;
  }

  /** Column of the first non-blank character of a line, or -1 for a blank (or comment-only) line. */
  indent(line: number): number {
    const start = this.lineStarts[line];
    let i = start;
    while (i < this.masked.length && (this.masked[i] === ' ' || this.masked[i] === '\t')) {
      i++;
    }
    return i >= this.masked.length || this.masked[i] === '\n' || this.masked[i] === '\r' ? -1 : i - start;
  }

  lineOf(offset: number): number {
    return this.lines.positionAt(offset).line;
  }

  /**
   * End offset of the construct starting on `line` whose body is indented
   * more than `column` (the offside rule): the end of the last line before
   * one that is indented `column` or less.
   */
  blockEnd(line: number, column: number): number {
    let last = line;
    for (let l = line + 1; l < this.lineCount; l++) {
      const indent = this.indent(l);
      if (indent === -1) {
        continue;
      }
      if (indent <= column) {
        break;
      }
      last = l;
    }
    return this.lineEnd(last);
  }
}

function findContainers(source: Source): Container[] {
  const { masked } = source;
  const containers: Container[] = [];
  const modifiers = '(?:(?:private|internal|public|rec)\\s+)*';
  const name = '([A-Za-z_][\\w\']*(?:\\.[A-Za-z_][\\w\']*)*|``[^`\\n]+``)';

  const namespaces: { name: string; start: number; nameStart: number }[] = [];
  const ns = new RegExp(`^[ \\t]*namespace\\s+(?:rec\\s+)?([\\w.]+)`, 'gm');
  let m: RegExpExecArray | null;
  while ((m = ns.exec(masked))) {
    namespaces.push({ name: m[1], start: m.index, nameStart: m.index + m[0].length - m[1].length });
  }
  const namespaceEnd = (offset: number) => namespaces.find(n => n.start > offset)?.start ?? masked.length;
  for (const n of namespaces) {
    containers.push({ kind: 'namespace', name: n.name, start: n.start, nameStart: n.nameStart, end: namespaceEnd(n.start) - 1 });
  }

  // `module A.B` at the top of a file (no `=`) spans the rest of it; `module X =` nests by indentation.
  const module = new RegExp(`^([ \\t]*)module\\s+${modifiers}${name}[ \\t]*(=)?`, 'gm');
  while ((m = module.exec(masked))) {
    const nameStart = m.index + m[0].indexOf(m[2], m[1].length + 'module'.length);
    const moduleName = unquote(m[2]);
    const line = source.lineOf(m.index);
    const end = m[3] ? source.blockEnd(line, m[1].length) : namespaceEnd(m.index) - 1;
    containers.push({ kind: 'module', name: moduleName, start: m.index + m[1].length, nameStart: nameStart + (m[2].startsWith('``') ? 2 : 0), end });
  }

  const type = new RegExp(`^([ \\t]*)(?:\\[<[^\\n]*>\\][ \\t]*)?type\\s+(?:(?:private|internal|public)\\s+)?${name}`, 'gm');
  while ((m = type.exec(masked))) {
    const keyword = m.index + m[0].search(/\btype\s/);
    const nameStart = m.index + m[0].length - m[2].length;
    containers.push({
      kind: 'type',
      name: unquote(m[2]),
      start: keyword,
      nameStart: nameStart + (m[2].startsWith('``') ? 2 : 0),
      end: source.blockEnd(source.lineOf(m.index), m[1].length),
    });
  }
  return containers;
}

/** Finds every `let` / `member` binding preceded by one or more attribute lists. */
function findAttributedBindings(source: Source): Binding[] {
  const { masked } = source;
  const bindings: Binding[] = [];
  let i = masked.indexOf('[<');
  while (i !== -1) {
    const start = i;
    const attributes: string[] = [];
    let cursor = i;
    while (masked.startsWith('[<', cursor)) {
      const close = findAttributeEnd(masked, cursor + 2);
      if (close === -1) {
        break;
      }
      attributes.push(...parseAttributeNames(masked.slice(cursor + 2, close)));
      cursor = close + 2;
      while (cursor < masked.length && /\s/.test(masked[cursor])) {
        cursor++;
      }
    }
    const binding = readBinding(source, cursor);
    if (binding) {
      bindings.push({ ...binding, start, attributes });
    }
    i = masked.indexOf('[<', Math.max(cursor, i + 2));
  }
  return bindings;
}

/** Offset of the `>]` that closes an attribute list whose contents start at `from`. */
function findAttributeEnd(masked: string, from: number): number {
  let depth = 0;
  for (let j = from; j < masked.length - 1; j++) {
    const ch = masked[j];
    if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
    } else if (ch === '>' && masked[j + 1] === ']' && depth <= 0) {
      return j;
    }
  }
  return -1;
}

function parseAttributeNames(content: string): string[] {
  const names: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of content + ';') {
    if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
    }
    if (ch === ';' && depth === 0) {
      const match = /^\s*(?:\w+\s*:(?!:))?\s*([\w.]+)/.exec(current);
      if (match) {
        const name = match[1].split('.').pop() ?? '';
        names.push(name.endsWith('Attribute') && name !== 'Attribute' ? name.slice(0, -'Attribute'.length) : name);
      }
      current = '';
    } else {
      current += ch;
    }
  }
  return names;
}

/** Reads `let name`, `member self.Name`, `static member Name`, ... at `offset`. */
function readBinding(source: Source, offset: number): Omit<Binding, 'start' | 'attributes'> | undefined {
  const pattern = /(?:static\s+)?(?:let|member|override|default)\s+(?:(?:private|internal|public|inline|rec|mutable)\s+)*(?:(?:[A-Za-z_][\w']*|_)\.)?([A-Za-z_][\w']*|``[^`\n]+``)/y;
  pattern.lastIndex = offset;
  const m = pattern.exec(source.masked);
  if (!m) {
    return undefined;
  }
  const quoted = m[1].startsWith('``');
  const nameStart = offset + m[0].length - m[1].length + (quoted ? 2 : 0);
  const line = source.lineOf(offset);
  return { name: unquote(m[1]), nameStart, end: source.blockEnd(line, source.indent(line)) };
}

/**
 * Code in a test class that runs for every test: `let` values and `do`
 * bindings of the primary constructor, secondary constructors, and xUnit
 * lifecycle members.
 */
function implicitSetup(source: Source, type: Container): { start: number; end: number }[] {
  const regions: { start: number; end: number }[] = [];
  const firstLine = source.lineOf(type.start);
  const lastLine = source.lineOf(type.end);
  let memberIndent = -1;
  for (let line = firstLine + 1; line <= lastLine; line++) {
    const indent = source.indent(line);
    if (indent === -1) {
      continue;
    }
    if (memberIndent === -1) {
      memberIndent = indent;
    }
    if (indent !== memberIndent) {
      continue;
    }
    const start = source.lineStart(line) + indent;
    const rest = source.masked.slice(start, source.lineEnd(line));
    const lifecycle = /^(?:member|override|default)\s+(?:[A-Za-z_][\w']*|_)\.(\w+)/.exec(rest)
      ?? /^interface\s+(?:[\w.]+\.)?(IDisposable|IAsyncLifetime|IAsyncDisposable)\b/.exec(rest);
    // `let x = ...` runs when the class is constructed; `let f x = ...` only when it is called.
    const value = /^let\s+(?:mutable\s+)?(?:[A-Za-z_][\w']*|``[^`\n]+``)\s*(?::[^=]*)?=/.test(rest);
    if (value || /^(?:do|new)\b/.test(rest) || (lifecycle && (LIFECYCLE_MEMBERS.has(lifecycle[1]) || lifecycle[0].startsWith('interface')))) {
      regions.push({ start, end: source.blockEnd(line, indent) });
    }
  }
  return regions;
}

function findExpectoTests(source: Source): TestDeclaration[] {
  const { masked, text, lines } = source;
  const names = [...EXPECTO_TESTS, ...EXPECTO_SUITES].flatMap(n => [n, `p${n}`, `f${n}`]);
  const call = new RegExp(`(?<![\\w.'])(${names.join('|')})(?![\\w'])`, 'g');
  const found: { kind: 'test' | 'suite'; name: string; start: number; end: number; nameStart: number }[] = [];

  let m: RegExpExecArray | null;
  while ((m = call.exec(masked))) {
    const fn = m[1].replace(/^[pf](?=test)/, '');
    let i = m.index + m[0].length;
    const skipSpace = () => {
      while (i < masked.length && (masked[i] === ' ' || masked[i] === '\t')) {
        i++;
      }
    };
    skipSpace();
    if (fn.startsWith('testPropertyWithConfig')) {
      // The configuration comes first: an identifier or a parenthesised expression.
      const arg = /^(?:[A-Za-z_][\w'.]*|\()/.exec(masked.slice(i, i + 200));
      if (!arg) {
        continue;
      }
      i = arg[0] === '(' ? findMatchingBracket(masked, i) + 1 : i + arg[0].length;
      if (i === 0) {
        continue;
      }
      skipSpace();
    }
    if (masked[i] !== '"') {
      continue; // not a declaration, e.g. `let test = ...`
    }
    const close = masked.indexOf('"', i + 1);
    if (close === -1) {
      continue;
    }
    const name = text.slice(i + 1, close);
    const line = source.lineOf(m.index);
    const column = m.index - source.lineStart(line);
    let end = source.blockEnd(line, column);
    // A body in brackets may close at the call's own column: `test "x" {` ... `}`.
    let j = close + 1;
    while (j < masked.length && (masked[j] === ' ' || masked[j] === '\t')) {
      j++;
    }
    if ('[{('.includes(masked[j])) {
      const bracketEnd = findMatchingBracket(masked, j);
      end = Math.max(end, bracketEnd === -1 ? masked.length : bracketEnd + 1);
    }
    found.push({ kind: EXPECTO_SUITES.includes(fn) ? 'suite' : 'test', name, start: m.index, end, nameStart: i + 1 });
  }

  const suites = found.filter(f => f.kind === 'suite');
  return found.map(f => {
    const range = lines.rangeAt(f.start, f.end);
    const path = suites
      .filter(s => s !== f && s.start < f.start && f.end <= s.end && rangeContainsRange(lines.rangeAt(s.start, s.end), range))
      .sort((a, b) => a.start - b.start)
      .map(s => s.name);
    return {
      kind: f.kind,
      name: f.name,
      path: [...path, f.name],
      range,
      nameRange: lines.rangeAt(f.nameStart, f.nameStart + f.name.length),
    };
  });
}

function unquote(name: string): string {
  return name.startsWith('``') ? name.slice(2, -2) : name;
}
