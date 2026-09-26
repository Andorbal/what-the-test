import * as assert from 'assert';
import { changedLines } from '../../core/lineDiff';

const lines = (...l: string[]) => l.join('\n');

describe('changedLines', () => {
  it('finds nothing when the text is unchanged, ignoring line endings', () => {
    assert.deepStrictEqual(changedLines(lines('a', 'b', 'c'), lines('a', 'b', 'c')), []);
    assert.deepStrictEqual(changedLines('a\r\nb\r\n', 'a\nb\n'), []);
  });

  it('finds modified and inserted lines', () => {
    assert.deepStrictEqual(changedLines(lines('a', 'b', 'c'), lines('a', 'B', 'c')), [1]);
    assert.deepStrictEqual(changedLines(lines('a', 'b', 'c'), lines('a', 'x', 'b', 'c', 'y')), [1, 4]);
    assert.deepStrictEqual(changedLines(lines('a', 'b'), lines('x', 'a', 'b')), [0]);
  });

  it('marks the lines around a deletion', () => {
    assert.deepStrictEqual(changedLines(lines('a', 'b', 'c', 'd'), lines('a', 'd')), [0, 1]);
    assert.deepStrictEqual(changedLines(lines('a', 'b'), lines('b')), [0]);
    assert.deepStrictEqual(changedLines(lines('a', 'b'), lines('a')), [0]);
    assert.deepStrictEqual(changedLines(lines('a'), ''), []);
  });

  it('treats every line of a new file as changed', () => {
    assert.deepStrictEqual(changedLines('', lines('a', 'b', 'c')), [0, 1, 2]);
  });

  it('matches repeated lines to find the minimal change', () => {
    const before = lines('function f() {', '  return 1;', '}', '', 'function g() {', '  return 1;', '}');
    const after = lines('function f() {', '  return 1;', '}', '', 'function g() {', '  const x = 2;', '  return 1;', '}');
    assert.deepStrictEqual(changedLines(before, after), [5]);
  });

  it('handles many scattered edits in a large file', () => {
    const before = Array.from({ length: 5000 }, (_, i) => `line ${i}`);
    const after = before.map((l, i) => (i % 100 === 50 ? `${l} changed` : l));
    const expected = before.map((_, i) => i).filter(i => i % 100 === 50);
    assert.deepStrictEqual(changedLines(before.join('\n'), after.join('\n')), expected);
  });

  it('falls back to the whole changed region when the files differ too much', () => {
    const before = Array.from({ length: 3000 }, (_, i) => `old ${i}`);
    const after = ['keep', ...Array.from({ length: 3000 }, (_, i) => `new ${i}`), 'end'];
    const result = changedLines(['keep', ...before, 'end'].join('\n'), after.join('\n'));
    assert.strictEqual(result.length, 3000);
    assert.strictEqual(result[0], 1);
    assert.strictEqual(result[result.length - 1], 3000);
  });
});
