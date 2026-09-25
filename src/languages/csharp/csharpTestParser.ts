import { ParsedTestFile, SetupRegion, TestDeclaration } from '../../core/types';
import { LineIndex, findMatchingBracket, isIdentifierChar, skipWhitespace } from '../text';
import { maskCSharp } from './csharpMask';

/** xUnit, NUnit, MSTest, TUnit and FsCheck test attributes. */
export const DEFAULT_TEST_ATTRIBUTES = [
  'Fact', 'Theory', 'SkippableFact', 'SkippableTheory', 'StaFact', 'StaTheory', 'UIFact', 'UITheory',
  'Test', 'TestCase', 'TestCaseSource',
  'TestMethod', 'DataTestMethod',
  'Property',
];

/** Attributes marking methods that run around every test in their class. */
export const DEFAULT_SETUP_ATTRIBUTES = [
  'SetUp', 'TearDown', 'OneTimeSetUp', 'OneTimeTearDown',
  'TestInitialize', 'TestCleanup', 'ClassInitialize', 'ClassCleanup',
  'Before', 'After',
];

/** Lifecycle methods recognised by name (xUnit's IAsyncLifetime / IDisposable). */
const LIFECYCLE_METHOD_NAMES = new Set(['InitializeAsync', 'DisposeAsync', 'Dispose']);

export interface CSharpTestParserOptions {
  testAttributes?: readonly string[];
  setupAttributes?: readonly string[];
}

interface Container {
  kind: 'namespace' | 'type';
  name: string;
  start: number;
  bodyStart: number;
  end: number;
}

interface MethodInfo {
  name: string;
  nameStart: number;
  start: number;
  end: number;
  attributes: string[];
}

export function parseCSharpTests(text: string, options: CSharpTestParserOptions = {}): ParsedTestFile {
  const testAttributes = new Set(options.testAttributes ?? DEFAULT_TEST_ATTRIBUTES);
  const setupAttributes = new Set(options.setupAttributes ?? DEFAULT_SETUP_ATTRIBUTES);
  const masked = maskCSharp(text);
  const lines = new LineIndex(text);

  const containers = findContainers(masked);
  const methods = findAttributedMethods(masked);

  const pathFor = (offset: number) =>
    containers
      .filter(c => c.bodyStart <= offset && offset <= c.end)
      .sort((a, b) => a.start - b.start)
      .map(c => c.name);

  const declarations: TestDeclaration[] = [];
  const setupRegions: SetupRegion[] = [];
  const typesWithTests = new Set<Container>();

  for (const method of methods) {
    const range = lines.rangeAt(method.start, method.end);
    if (method.attributes.some(a => testAttributes.has(a))) {
      declarations.push({
        kind: 'test',
        name: method.name,
        path: [...pathFor(method.start), method.name],
        range,
        nameRange: lines.rangeAt(method.nameStart, method.nameStart + method.name.length),
      });
      const owner = innermostType(containers, method.start);
      if (owner) {
        typesWithTests.add(owner);
      }
    } else if (method.attributes.some(a => setupAttributes.has(a))) {
      setupRegions.push({ range });
    }
  }

  for (const type of typesWithTests) {
    const nameStart = masked.indexOf(type.name, type.start);
    declarations.push({
      kind: 'suite',
      name: type.name,
      path: pathFor(type.start).concat(type.name),
      range: lines.rangeAt(type.start, type.end + 1),
      nameRange: lines.rangeAt(nameStart, nameStart + type.name.length),
    });
    for (const region of findImplicitSetup(masked, type)) {
      setupRegions.push({ range: lines.rangeAt(region.start, region.end) });
    }
  }

  declarations.sort((a, b) => a.range.start.line - b.range.start.line || a.range.start.character - b.range.start.character);
  return { declarations, setupRegions };
}

function innermostType(containers: Container[], offset: number): Container | undefined {
  let best: Container | undefined;
  for (const c of containers) {
    if (c.kind === 'type' && c.bodyStart <= offset && offset <= c.end && (!best || c.start > best.start)) {
      best = c;
    }
  }
  return best;
}

function findContainers(masked: string): Container[] {
  const containers: Container[] = [];

  const ns = /\bnamespace\s+([\w.@]+)\s*([{;])/g;
  let m: RegExpExecArray | null;
  while ((m = ns.exec(masked))) {
    const brace = m.index + m[0].length - 1;
    if (m[2] === ';') {
      containers.push({ kind: 'namespace', name: m[1], start: m.index, bodyStart: brace, end: masked.length });
    } else {
      const close = findMatchingBracket(masked, brace);
      containers.push({ kind: 'namespace', name: m[1], start: m.index, bodyStart: brace, end: close === -1 ? masked.length : close });
    }
  }

  const type = /\b(?:class|struct|interface|record(?:\s+(?:class|struct))?)\s+@?([A-Za-z_]\w*)/g;
  while ((m = type.exec(masked))) {
    if (m[1] === 'where') {
      continue;
    }
    // Find the body: the first `{` before a terminating `;` (positional records).
    let i = m.index + m[0].length;
    let depth = 0;
    let body = -1;
    for (; i < masked.length; i++) {
      const ch = masked[i];
      if (ch === '(' || ch === '<' || ch === '[') {
        depth++;
      } else if (ch === ')' || ch === '>' || ch === ']') {
        depth--;
      } else if (depth <= 0 && ch === '{') {
        body = i;
        break;
      } else if (depth <= 0 && ch === ';') {
        break;
      }
    }
    if (body === -1) {
      continue;
    }
    const close = findMatchingBracket(masked, body);
    containers.push({ kind: 'type', name: m[1], start: m.index, bodyStart: body, end: close === -1 ? masked.length : close });
  }
  return containers;
}

/** Finds every method that is preceded by one or more attribute lists. */
function findAttributedMethods(masked: string): MethodInfo[] {
  const methods: MethodInfo[] = [];
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] !== '[' || !isAttributePosition(masked, i)) {
      continue;
    }
    const start = i;
    const attributes: string[] = [];
    let cursor = i;
    while (masked[cursor] === '[') {
      const close = findMatchingBracket(masked, cursor);
      if (close === -1) {
        break;
      }
      attributes.push(...parseAttributeNames(masked.slice(cursor + 1, close)));
      cursor = skipWhitespace(masked, close + 1);
    }
    const method = readMethod(masked, cursor);
    if (method) {
      methods.push({ ...method, start, attributes });
      i = method.end - 1;
    } else {
      i = cursor - 1;
    }
  }
  return methods;
}

function isAttributePosition(masked: string, offset: number): boolean {
  let j = offset - 1;
  while (j >= 0 && /\s/.test(masked[j])) {
    j--;
  }
  return j < 0 || '{};]'.includes(masked[j]);
}

function parseAttributeNames(content: string): string[] {
  const names: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of content + ',') {
    if (ch === '(' || ch === '<' || ch === '{') {
      depth++;
    } else if (ch === ')' || ch === '>' || ch === '}') {
      depth--;
    }
    if (ch === ',' && depth === 0) {
      const match = /^\s*(?:\w+\s*:(?!:))?\s*([\w.:]+)/.exec(current);
      if (match) {
        const name = match[1].split(/[.:]/).pop() ?? '';
        names.push(name.endsWith('Attribute') && name !== 'Attribute' ? name.slice(0, -'Attribute'.length) : name);
      }
      current = '';
    } else {
      current += ch;
    }
  }
  return names;
}

/**
 * Reads a method declaration starting at `offset` (just after its attributes):
 * modifiers, return type, name, parameter list and body.
 */
function readMethod(masked: string, offset: number): Omit<MethodInfo, 'start' | 'attributes'> | undefined {
  let i = offset;
  let lastIdentStart = -1;
  let lastIdentEnd = -1;
  let angle = 0;
  for (; i < masked.length; i++) {
    const ch = masked[i];
    if (ch === '<') {
      angle++;
    } else if (ch === '>') {
      angle--;
    } else if (angle === 0 && ch === '(') {
      break;
    } else if (ch === '{' || ch === ';' || ch === '=' || ch === '[' || ch === '}') {
      return undefined; // property, field, or something else
    } else if (angle === 0 && isIdentifierChar(ch) && !isIdentifierChar(masked[i - 1])) {
      lastIdentStart = i;
      let j = i;
      while (isIdentifierChar(masked[j])) {
        j++;
      }
      lastIdentEnd = j;
      i = j - 1;
    }
  }
  if (lastIdentStart === -1 || masked[i] !== '(') {
    return undefined;
  }
  const paramsClose = findMatchingBracket(masked, i);
  if (paramsClose === -1) {
    return undefined;
  }
  let end = -1;
  for (let j = paramsClose + 1; j < masked.length; j++) {
    const ch = masked[j];
    if (ch === '{') {
      const close = findMatchingBracket(masked, j);
      end = close === -1 ? masked.length : close + 1;
      break;
    }
    if (ch === ';') {
      end = j + 1;
      break;
    }
    if (ch === '=' && masked[j + 1] === '>') {
      const semi = masked.indexOf(';', j);
      end = semi === -1 ? masked.length : semi + 1;
      break;
    }
  }
  if (end === -1) {
    return undefined;
  }
  return { name: masked.slice(lastIdentStart, lastIdentEnd), nameStart: lastIdentStart, end };
}

/** Constructors and xUnit lifecycle methods of a test class. */
function findImplicitSetup(masked: string, type: Container): { start: number; end: number }[] {
  const regions: { start: number; end: number }[] = [];
  const names = [type.name, ...LIFECYCLE_METHOD_NAMES].map(n => n.replace(/[^\w]/g, '')).join('|');
  const pattern = new RegExp(`\\b(${names})\\s*\\(`, 'g');
  pattern.lastIndex = type.bodyStart + 1;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(masked)) && m.index < type.end) {
    if (!isMemberDeclarationStart(masked, m.index, type.bodyStart, m[1] !== type.name)) {
      continue;
    }
    const method = readMethod(masked, m.index);
    if (method) {
      regions.push({ start: m.index, end: method.end });
      pattern.lastIndex = method.end;
    }
  }
  return regions;
}

/** True if only modifiers/a return type sit between the previous `{`, `}` or `;` and `offset`. */
function isMemberDeclarationStart(masked: string, offset: number, bodyStart: number, needsReturnType: boolean): boolean {
  let j = offset - 1;
  while (j > bodyStart && !'{};]'.includes(masked[j])) {
    j--;
  }
  const prefix = masked.slice(j + 1, offset);
  return /^[\s\w<>,?]*$/.test(prefix) && !/\b(new|return|await)\b/.test(prefix) && (!needsReturnType || /\w/.test(prefix));
}
