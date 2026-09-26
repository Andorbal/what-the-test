import * as assert from 'assert';
import { declarationAt } from '../../core/types';
import { maskPython } from '../../languages/python/pythonMask';
import { parsePythonTests } from '../../languages/python/pythonTestParser';

const lineOf = (text: string, needle: string) => text.split('\n').findIndex(l => l.includes(needle));
const at = (text: string, needle: string) => ({ line: lineOf(text, needle), character: text.split('\n')[lineOf(text, needle)].indexOf(needle) });

describe('maskPython', () => {
  it('masks comments and all kinds of strings', () => {
    const src = [
      'a = "def test_a():"',
      "b = 'def test_b():'",
      'c = """',
      'def test_c():',
      '"""',
      "d = rb'def test_d():'",
      'e = f"{x["def test_e():"]} def test_e2():"',
      '# def test_f():',
      'g = 1  # def test_g():',
    ].join('\n');
    const masked = maskPython(src);
    assert.strictEqual(masked.length, src.length);
    assert.ok(!masked.includes('def'), masked);
    assert.ok(masked.includes('g = 1'));
  });
});

describe('parsePythonTests', () => {
  it('finds pytest functions and classes, with decorators and multi-line signatures', () => {
    const src = [
      'import pytest',
      '',
      'def helper():',
      '    return 1',
      '',
      'def test_add(calculator):',
      '    assert calculator.add(1, 2) == 3',
      '',
      '',
      '@pytest.mark.parametrize(',
      '    "values, expected",',
      '    [([1, 2, 3], 6), ([], 0)],',
      ')',
      'def test_sum(',
      '    calculator,',
      '    values,',
      '    expected,',
      '):',
      '    total = calculator.sum(',
      'values)',
      '    assert total == expected',
      '',
      'class TestShout:',
      '    def test_shouts(self):',
      '        assert shout("hi") == "HI!"',
      '',
      '    def not_a_test(self):',
      '        pass',
      '',
      '    class TestNested:',
      '        async def test_inner(self):',
      '            await thing()',
      '',
      'class Helper:',
      '    def test_ignored(self):',
      '        pass',
      '',
      '@pytest.fixture',
      'def test_data():',
      '    return []',
    ].join('\n');
    const parsed = parsePythonTests(src);
    assert.deepStrictEqual(parsed.declarations.map(d => [d.kind, d.path.join('::')]), [
      ['test', 'test_add'],
      ['test', 'test_sum'],
      ['suite', 'TestShout'],
      ['test', 'TestShout::test_shouts'],
      ['suite', 'TestShout::TestNested'],
      ['test', 'TestShout::TestNested::test_inner'],
    ]);
    const sum = parsed.declarations[1];
    assert.deepStrictEqual([sum.range.start.line, sum.range.end.line], [lineOf(src, '@pytest.mark.parametrize'), lineOf(src, 'assert total == expected')]);
    assert.deepStrictEqual(sum.nameRange.start, at(src, 'test_sum'));
    const find = (needle: string) => declarationAt(parsed, at(src, needle))?.name;
    assert.strictEqual(find('values)'), 'test_sum');
    assert.strictEqual(find('await thing()'), 'test_inner');
    assert.strictEqual(find('return 1'), undefined);
    const shout = parsed.declarations[2];
    assert.deepStrictEqual([shout.range.start.line, shout.range.end.line], [lineOf(src, 'class TestShout'), lineOf(src, 'await thing()')]);
  });

  it('finds unittest test cases and their setup', () => {
    const src = [
      'import unittest',
      '',
      'class CalculatorTestCase(unittest.TestCase):',
      '    @classmethod',
      '    def setUpClass(cls):',
      '        cls.shared = Shared()',
      '',
      '    def setUp(self):',
      '        self.calculator = Calculator()',
      '',
      '    def test_add(self):',
      '        self.assertEqual(self.calculator.add(2, 2), 4)',
      '',
      '    def helper(self):',
      '        return 1',
    ].join('\n');
    const parsed = parsePythonTests(src);
    assert.deepStrictEqual(parsed.declarations.map(d => [d.kind, d.path.join('::')]), [
      ['suite', 'CalculatorTestCase'],
      ['test', 'CalculatorTestCase::test_add'],
    ]);
    const find = (needle: string) => declarationAt(parsed, at(src, needle))?.name;
    assert.strictEqual(find('self.calculator = Calculator()'), 'CalculatorTestCase');
    assert.strictEqual(find('cls.shared = Shared()'), 'CalculatorTestCase');
    assert.strictEqual(find('return 1'), undefined);
  });

  it('treats autouse fixtures and module setup as setup of the module or class', () => {
    const src = [
      'import pytest',
      '',
      '@pytest.fixture(autouse=True)',
      'def reset_state():',
      '    State.reset()',
      '',
      '@pytest.fixture',
      'def calculator():',
      '    return Calculator()',
      '',
      'def setup_module(module):',
      '    connect()',
      '',
      'def test_one():',
      '    pass',
      '',
      'class TestGroup:',
      '    @pytest.fixture(autouse=True)',
      '    def per_test(self):',
      '        prepare()',
      '',
      '    def test_two(self):',
      '        pass',
    ].join('\n');
    const parsed = parsePythonTests(src, { moduleName: 'test_things.py' });
    assert.deepStrictEqual(parsed.declarations.map(d => [d.kind, d.path.join('::')]), [
      ['suite', 'test_things.py'],
      ['test', 'test_one'],
      ['suite', 'TestGroup'],
      ['test', 'TestGroup::test_two'],
    ]);
    const find = (needle: string) => declarationAt(parsed, at(src, needle))?.name;
    assert.strictEqual(find('State.reset()'), 'test_things.py');
    assert.strictEqual(find('connect()'), 'test_things.py');
    assert.strictEqual(find('prepare()'), 'TestGroup');
    assert.strictEqual(find('return Calculator()'), undefined, 'a regular fixture is walked through like a helper');
  });

  it('ignores tests inside strings and comments', () => {
    const src = ['x = """', 'def test_fake():', '    pass', '"""', '# def test_comment():'].join('\n');
    assert.deepStrictEqual(parsePythonTests(src).declarations, []);
  });
});
