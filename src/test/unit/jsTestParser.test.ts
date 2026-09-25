import * as assert from 'assert';
import { parseJavaScriptTests } from '../../languages/javascript/jsTestParser';
import { maskJavaScript } from '../../languages/javascript/jsMask';
import { declarationAt } from '../../core/types';

const lineOf = (text: string, needle: string) => text.split('\n').findIndex(l => l.includes(needle));

describe('maskJavaScript', () => {
  it('keeps length and line structure', () => {
    const src = "const a = 'x // y';\n// comment it('no')\nconst b = /it\\(/g; /* multi\nline */ const c = `t ${a} u`;";
    const masked = maskJavaScript(src);
    assert.strictEqual(masked.length, src.length);
    assert.deepStrictEqual(masked.split('\n').map(l => l.length), src.split('\n').map(l => l.length));
    assert.ok(!masked.includes('comment'));
    assert.ok(!masked.includes("it('no')"));
    assert.ok(!masked.includes('it\\('));
    assert.ok(masked.includes('${a}'), 'template substitutions are kept');
  });

  it('distinguishes division from regular expressions', () => {
    const masked = maskJavaScript('const x = a / b; const y = c / d; it("t", () => {});');
    assert.ok(masked.includes('a / b; const y = c / d;'));
    assert.ok(masked.includes('it("'));
  });
});

describe('parseJavaScriptTests', () => {
  it('finds nested describe/it blocks with paths and ranges', () => {
    const src = [
      "import { add } from './calc';",
      '',
      "describe('Calculator', () => {",
      "  describe('add', () => {",
      "    it('adds two numbers', () => {",
      '      expect(add(1, 2)).toBe(3);',
      '    });',
      '',
      '    test("handles negatives", async () => {',
      '      expect(add(-1, -2)).toBe(-3);',
      '    });',
      '  });',
      '});',
    ].join('\n');
    const parsed = parseJavaScriptTests(src);
    const tests = parsed.declarations.filter(d => d.kind === 'test');
    assert.deepStrictEqual(tests.map(t => t.path), [
      ['Calculator', 'add', 'adds two numbers'],
      ['Calculator', 'add', 'handles negatives'],
    ]);
    const decl = declarationAt(parsed, { line: lineOf(src, 'add(1, 2)'), character: 6 });
    assert.strictEqual(decl?.name, 'adds two numbers');
    assert.deepStrictEqual(tests[0].nameRange.start, { line: 4, character: 8 });
    assert.strictEqual(tests[0].range.end.line, 6);
  });

  it('handles modifiers, each tables, generics and escaped titles', () => {
    const src = [
      "describe.only('suite', () => {",
      "  it.skip('skipped', () => {});",
      "  it.each([[1, 2], [3, 4]])('adds %i', (a, b) => {});",
      '  test.each`',
      '    a    | b',
      '    ${1} | ${2}',
      "  `('table $a', ({ a }) => {});",
      "  test.each<Case>(cases)('typed %s', () => {});",
      "  it('it\\'s escaped', () => {});",
      "  it.concurrent.only('chained', async () => {});",
      '});',
    ].join('\n');
    const names = parseJavaScriptTests(src).declarations.filter(d => d.kind === 'test').map(d => d.name);
    assert.deepStrictEqual(names, ['skipped', 'adds %i', 'table $a', 'typed %s', "it's escaped", 'chained']);
  });

  it('recognises Playwright style test.describe and ignores test.step', () => {
    const src = [
      "test.describe('login', () => {",
      "  test.beforeEach(async ({ page }) => { await page.goto('/'); });",
      "  test('works', async ({ page }) => {",
      "    await test.step('fill form', async () => {});",
      '  });',
      '});',
    ].join('\n');
    const parsed = parseJavaScriptTests(src);
    assert.deepStrictEqual(parsed.declarations.map(d => `${d.kind}:${d.path.join('/')}`), ['suite:login', 'test:login/works']);
    assert.strictEqual(parsed.setupRegions.length, 1);
    const inHook = declarationAt(parsed, { line: 1, character: 45 });
    assert.strictEqual(inHook?.kind, 'suite');
    assert.strictEqual(inHook?.name, 'login');
  });

  it('ignores methods named like test functions and calls inside strings', () => {
    const src = [
      "const it2 = obj.it('not a test', () => {});",
      "const s = \"it('fake', () => {})\";",
      '// it("commented", () => {})',
      "suite('tdd', function () { test('real', function () {}); });",
    ].join('\n');
    const decls = parseJavaScriptTests(src).declarations;
    assert.deepStrictEqual(decls.map(d => d.name), ['tdd', 'real']);
  });

  it('accepts non-literal suite names such as describe(MyClass, ...)', () => {
    const src = "describe(Parser.name, () => { it('parses', () => {}); });";
    const decls = parseJavaScriptTests(src).declarations;
    assert.deepStrictEqual(decls.map(d => d.path), [['Parser'], ['Parser', 'parses']]);
  });

  it('supports custom function names', () => {
    const src = "feature('checkout', () => { scenario('pays', () => {}); });";
    const decls = parseJavaScriptTests(src, {
      testFunctions: ['scenario'],
      suiteFunctions: ['feature'],
    }).declarations;
    assert.deepStrictEqual(decls.map(d => d.path), [['checkout'], ['checkout', 'pays']]);
  });

  it('returns nothing for code outside tests', () => {
    const src = "export function helper() { return 1; }\ndescribe('s', () => { it('t', () => helper()); });";
    const parsed = parseJavaScriptTests(src);
    assert.strictEqual(declarationAt(parsed, { line: 0, character: 30 }), undefined);
  });
});
