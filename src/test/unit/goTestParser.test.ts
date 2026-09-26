import * as assert from 'assert';
import { declarationAt } from '../../core/types';
import { maskGo } from '../../languages/go/goMask';
import { parseGoTests } from '../../languages/go/goTestParser';

const lineOf = (text: string, needle: string) => text.split('\n').findIndex(l => l.includes(needle));
const at = (text: string, needle: string) => ({ line: lineOf(text, needle), character: text.split('\n')[lineOf(text, needle)].indexOf(needle) });

describe('maskGo', () => {
  it('masks strings, raw strings, runes and comments', () => {
    const src = [
      'var a = "func TestA(t *testing.T) {"',
      'var b = `raw',
      'func TestB(t *testing.T) {`',
      "var c = '{'",
      '// func TestC(t *testing.T) {',
      '/* func TestD(t *testing.T) { */ var d = 1',
    ].join('\n');
    const masked = maskGo(src);
    assert.strictEqual(masked.length, src.length);
    assert.ok(!/Test[A-D]|\{/.test(masked), masked);
    assert.ok(masked.includes('var d = 1'));
  });
});

describe('parseGoTests', () => {
  it('finds tests, benchmarks, fuzz tests and examples', () => {
    const src = [
      'package calc',
      '',
      'import "testing"',
      '',
      'func TestAdd(t *testing.T) {',
      '\tif Add(1, 2) != 3 {',
      '\t\tt.Fatal("bad")',
      '\t}',
      '}',
      '',
      'func TestMain(m *testing.M) { m.Run() }',
      'func Testable(t *testing.T) {}',
      'func helper(t *testing.T) int { return 1 }',
      'func BenchmarkAdd(b *testing.B) {',
      '\tfor i := 0; i < b.N; i++ {',
      '\t\tAdd(1, 2)',
      '\t}',
      '}',
      'func FuzzAdd(f *testing.F) { f.Fuzz(func(t *testing.T, a int) { Add(a, a) }) }',
      'func ExampleAdd() {',
      '\tfmt.Println(Add(1, 2))',
      '\t// Output: 3',
      '}',
      'func Test_underscore(t *testing.T) (err error) { return nil }',
    ].join('\n');
    const { declarations } = parseGoTests(src);
    assert.deepStrictEqual(declarations.map(d => d.name), ['TestAdd', 'BenchmarkAdd', 'FuzzAdd', 'ExampleAdd', 'Test_underscore']);
    const add = declarations[0];
    assert.deepStrictEqual([add.range.start.line, add.range.end.line], [lineOf(src, 'func TestAdd'), lineOf(src, 'func TestAdd') + 4]);
    assert.deepStrictEqual(add.nameRange.start, at(src, 'TestAdd'));
  });

  it('finds subtests with literal names, nested, and skips dynamic names', () => {
    const src = [
      'func TestSum(t *testing.T) {',
      '\tt.Run("empty list", func(t *testing.T) {',
      '\t\tif Sum() != 0 { t.Fatal("bad") }',
      '\t})',
      '\tt.Run(`grouped`, func(t *testing.T) {',
      '\t\tt.Run("one", func(t *testing.T) {',
      '\t\t\tSum(1)',
      '\t\t})',
      '\t})',
      '\tfor _, tc := range cases {',
      '\t\tt.Run(tc.name, func(t *testing.T) {',
      '\t\t\tSum(tc.values...)',
      '\t\t})',
      '\t}',
      '}',
    ].join('\n');
    const parsed = parseGoTests(src);
    assert.deepStrictEqual(parsed.declarations.map(d => d.path.join('/')), [
      'TestSum', 'TestSum/empty_list', 'TestSum/grouped', 'TestSum/grouped/one',
    ]);
    const find = (needle: string) => declarationAt(parsed, at(src, needle))?.path.join('/');
    assert.strictEqual(find('Sum() != 0'), 'TestSum/empty_list');
    assert.strictEqual(find('Sum(1)'), 'TestSum/grouped/one');
    assert.strictEqual(find('Sum(tc.values...)'), 'TestSum');
  });

  it('finds testify suite methods and their setup', () => {
    const src = [
      'type CalcSuite struct {',
      '\tsuite.Suite',
      '\tcalc *Calculator',
      '}',
      '',
      'func (s *CalcSuite) SetupTest() {',
      '\ts.calc = NewCalculator()',
      '}',
      '',
      'func (s *CalcSuite) TestAdd() {',
      '\ts.Equal(3, s.calc.Add(1, 2))',
      '}',
      '',
      'func (s *CalcSuite) helper() int { return 1 }',
      '',
      'func TestCalcSuite(t *testing.T) {',
      '\tsuite.Run(t, new(CalcSuite))',
      '}',
    ].join('\n');
    const parsed = parseGoTests(src);
    assert.deepStrictEqual(parsed.declarations.map(d => [d.kind, d.path.join('/')]), [
      ['suite', 'CalcSuite'],
      ['test', 'CalcSuite/TestAdd'],
      ['test', 'TestCalcSuite'],
    ]);
    assert.strictEqual(declarationAt(parsed, at(src, 's.calc = NewCalculator()'))?.name, 'CalcSuite');
    assert.strictEqual(declarationAt(parsed, at(src, 'return 1')), undefined);
  });
});
