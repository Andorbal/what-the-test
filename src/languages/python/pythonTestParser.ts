import { ParsedTestFile, SetupRegion, TestDeclaration } from '../../core/types';
import { LineIndex } from '../text';
import { maskPython } from './pythonMask';

/** Methods of a test class that run around its tests (unittest, pytest, nose). */
const CLASS_SETUP = new Set([
  'setUp', 'tearDown', 'setUpClass', 'tearDownClass', 'asyncSetUp', 'asyncTearDown',
  'setup_method', 'teardown_method', 'setup_class', 'teardown_class', 'setup', 'teardown',
]);
/** Module-level functions that run around the module's tests. */
const MODULE_SETUP = new Set(['setup_module', 'teardown_module', 'setup_function', 'teardown_function', 'setUpModule', 'tearDownModule']);

export interface PythonTestParserOptions {
  /** Name of the module's suite, e.g. `test_calculator.py`. Without it, the module isn't a suite. */
  moduleName?: string;
}

/** A `def` or `class` statement. */
interface Block {
  kind: 'def' | 'class';
  name: string;
  nameStart: number;
  /** Start of the first decorator, or of the statement. */
  start: number;
  end: number;
  indent: number;
  decorators: string;
  bases: string;
  parent?: Block;
}

/**
 * Finds pytest and unittest tests in a Python file: `test*` functions,
 * `test*` methods of `Test*` classes and of `TestCase` subclasses, their
 * setup methods, autouse fixtures and module-level setup functions.
 * Python nests code by indentation, so blocks end at the first line that is
 * indented no more than their `def` or `class`.
 */
export function parsePythonTests(text: string, options: PythonTestParserOptions = {}): ParsedTestFile {
  const masked = maskPython(text);
  const lines = new LineIndex(text);
  const blocks = findBlocks(masked);

  const declarations: TestDeclaration[] = [];
  const setupRegions: SetupRegion[] = [];
  const classesWithTests = new Set<Block>();
  const moduleSetup: Block[] = [];

  const isTestClass = (block: Block): boolean =>
    block.kind === 'class' && (/^Test/.test(block.name) || /\bTestCase\b/.test(block.bases)) &&
    (!block.parent || isTestClass(block.parent));
  const classPath = (block: Block | undefined): string[] => (block ? [...classPath(block.parent), block.name] : []);
  const isAutouse = (block: Block) => /\bfixture\b[\s\S]*\bautouse\s*=\s*True\b/.test(block.decorators);

  for (const block of blocks) {
    if (block.kind !== 'def') {
      continue;
    }
    const parent = block.parent;
    const range = lines.rangeAt(block.start, block.end);
    if (!parent || (parent.kind === 'class' && isTestClass(parent))) {
      if (/^test/.test(block.name) && !/\bfixture\b/.test(block.decorators)) {
        declarations.push({
          kind: 'test',
          name: block.name,
          path: [...classPath(parent), block.name],
          range,
          nameRange: lines.rangeAt(block.nameStart, block.nameStart + block.name.length),
        });
        for (let owner = parent; owner; owner = owner.parent) {
          classesWithTests.add(owner);
        }
      } else if (isAutouse(block) || (parent ? CLASS_SETUP.has(block.name) : MODULE_SETUP.has(block.name))) {
        (parent ? setupRegions.push({ range }) : moduleSetup.push(block));
      }
    }
  }

  for (const cls of classesWithTests) {
    declarations.push({
      kind: 'suite',
      name: cls.name,
      path: classPath(cls),
      range: lines.rangeAt(cls.start, cls.end),
      nameRange: lines.rangeAt(cls.nameStart, cls.nameStart + cls.name.length),
    });
  }
  if (options.moduleName && declarations.length) {
    declarations.push({
      kind: 'suite',
      name: options.moduleName,
      path: [options.moduleName],
      range: lines.rangeAt(0, text.length),
      nameRange: lines.rangeAt(0, 0),
    });
    for (const block of moduleSetup) {
      setupRegions.push({ range: lines.rangeAt(block.start, block.end) });
    }
  }

  declarations.sort((a, b) => a.range.start.line - b.range.start.line || a.range.start.character - b.range.start.character);
  return { declarations, setupRegions };
}

interface LogicalLine {
  start: number;
  indent: number;
  /** End of the logical line, including continuation lines, without trailing whitespace. */
  end: number;
}

/** Splits masked source into logical lines, joining lines continued by brackets or backslashes. */
function logicalLines(masked: string): LogicalLine[] {
  const result: LogicalLine[] = [];
  const n = masked.length;
  let pos = 0;
  while (pos < n) {
    let first = pos;
    while (first < n && (masked[first] === ' ' || masked[first] === '\t')) {
      first++;
    }
    let newline = masked.indexOf('\n', pos);
    let lineEnd = newline === -1 ? n : newline;
    let next = newline === -1 ? n : newline + 1;
    if (first >= lineEnd || masked[first] === '\r') {
      pos = next; // blank or comment-only line
      continue;
    }
    let depth = 0;
    let scanFrom = first;
    for (;;) {
      for (let k = scanFrom; k < lineEnd; k++) {
        const ch = masked[k];
        if (ch === '(' || ch === '[' || ch === '{') {
          depth++;
        } else if (ch === ')' || ch === ']' || ch === '}') {
          depth = Math.max(0, depth - 1);
        }
      }
      const continued = depth > 0 || /\\\s*$/.test(masked.slice(scanFrom, lineEnd));
      if (!continued || next >= n) {
        break;
      }
      scanFrom = next;
      newline = masked.indexOf('\n', next);
      lineEnd = newline === -1 ? n : newline;
      next = newline === -1 ? n : newline + 1;
    }
    let end = lineEnd;
    while (end > first && /\s/.test(masked[end - 1])) {
      end--;
    }
    result.push({ start: first, indent: first - pos, end });
    pos = next;
  }
  return result;
}

function findBlocks(masked: string): Block[] {
  const logical = logicalLines(masked);
  const blocks: Block[] = [];
  const open: Block[] = [];
  for (let index = 0; index < logical.length; index++) {
    const line = logical[index];
    const text = masked.slice(line.start, line.end);
    const m = /^(?:async\s+)?(def|class)\s+([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*(\([\s\S]*?\))?/.exec(text);
    if (!m) {
      continue;
    }
    // Decorators: the logical lines just above at the same indentation that start with `@`.
    let first = index;
    while (first > 0 && logical[first - 1].indent === line.indent && masked[logical[first - 1].start] === '@') {
      first--;
    }
    const decorators = logical.slice(first, index).map(l => masked.slice(l.start, l.end)).join('\n');
    // The body: every following logical line indented more than the statement.
    let last = index;
    while (last + 1 < logical.length && logical[last + 1].indent > line.indent) {
      last++;
    }
    const block: Block = {
      kind: m[1] as Block['kind'],
      name: m[2],
      nameStart: line.start + m[0].indexOf(m[2], m[0].indexOf(m[1]) + m[1].length),
      start: logical[first].start,
      end: logical[last].end,
      indent: line.indent,
      decorators,
      bases: m[1] === 'class' ? m[3] ?? '' : '',
    };
    while (open.length && !(open[open.length - 1].indent < block.indent && block.start < open[open.length - 1].end)) {
      open.pop();
    }
    block.parent = open[open.length - 1];
    blocks.push(block);
    open.push(block);
  }
  return blocks;
}
