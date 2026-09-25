import * as assert from 'assert';
import { parseCSharpTests } from '../../languages/csharp/csharpTestParser';
import { maskCSharp } from '../../languages/csharp/csharpMask';
import { declarationAt } from '../../core/types';

const lineOf = (text: string, needle: string) => text.split('\n').findIndex(l => l.includes(needle));

describe('maskCSharp', () => {
  it('masks all kinds of strings and comments while keeping offsets', () => {
    const src = [
      'var a = "x { y";',
      'var b = @"verbatim "" { quote";',
      'var c = $"interp {a} {{ {b.Replace("}", "")}";',
      'var d = """',
      '  raw { " string',
      '  """;',
      "var e = '{';",
      '// [Fact] comment',
      '/* [Test] */ var f = 1;',
    ].join('\n');
    const masked = maskCSharp(src);
    assert.strictEqual(masked.length, src.length);
    assert.ok(!/[{}]/.test(masked), `unexpected braces in: ${masked}`);
    assert.ok(!masked.includes('Fact'));
    assert.ok(!masked.includes('Test'));
    assert.ok(masked.includes('var f = 1;'));
  });
});

describe('parseCSharpTests', () => {
  it('finds xUnit facts and theories in a block-scoped namespace', () => {
    const src = [
      'using Xunit;',
      'namespace Calc.Tests',
      '{',
      '    public class CalculatorTests',
      '    {',
      '        private readonly Calculator _sut;',
      '        public CalculatorTests()',
      '        {',
      '            _sut = new Calculator();',
      '        }',
      '',
      '        [Fact]',
      '        public void Add_ReturnsSum()',
      '        {',
      '            Assert.Equal(3, _sut.Add(1, 2));',
      '        }',
      '',
      '        [Theory]',
      '        [InlineData(1, 2, 3)]',
      '        [InlineData(-1, -2, -3)]',
      '        public async Task Add_Theory(int a, int b, int expected) =>',
      '            Assert.Equal(expected, _sut.Add(a, b));',
      '',
      '        private int Helper() => _sut.Add(0, 0);',
      '    }',
      '}',
    ].join('\n');
    const parsed = parseCSharpTests(src);
    assert.deepStrictEqual(parsed.declarations.map(d => `${d.kind}:${d.path.join('/')}`), [
      'suite:Calc.Tests/CalculatorTests',
      'test:Calc.Tests/CalculatorTests/Add_ReturnsSum',
      'test:Calc.Tests/CalculatorTests/Add_Theory',
    ]);
    assert.strictEqual(declarationAt(parsed, { line: lineOf(src, '_sut.Add(1, 2)'), character: 20 })?.name, 'Add_ReturnsSum');
    assert.strictEqual(declarationAt(parsed, { line: lineOf(src, 'expected, _sut.Add(a, b)'), character: 20 })?.name, 'Add_Theory');
    // The xUnit constructor runs for every test in the class.
    assert.strictEqual(declarationAt(parsed, { line: lineOf(src, 'new Calculator()'), character: 20 })?.kind, 'suite');
    // A private helper isn't a test; the caller must keep walking the call graph.
    assert.strictEqual(declarationAt(parsed, { line: lineOf(src, 'Helper()'), character: 30 }), undefined);

    const fact = parsed.declarations[1];
    assert.deepStrictEqual(fact.nameRange.start, { line: lineOf(src, 'Add_ReturnsSum()'), character: 20 });
    assert.strictEqual(fact.range.start.line, lineOf(src, '[Fact]'));
  });

  it('finds NUnit and MSTest tests with file-scoped namespaces, setup and qualified attributes', () => {
    const src = [
      'namespace My.App.Tests;',
      '',
      '[TestFixture]',
      'public class ParserTests',
      '{',
      '    [SetUp] public void Init() { Parser.Reset(); }',
      '',
      '    [Test, Category("fast")]',
      '    public void Parses() { Parser.Parse("x"); }',
      '',
      '    [NUnit.Framework.TestCase(1)]',
      '    [TestCase(2)]',
      '    public void Cases(int n) { }',
      '',
      '    [Microsoft.VisualStudio.TestTools.UnitTesting.TestMethodAttribute]',
      '    public void Qualified() { }',
      '',
      '    public class Nested',
      '    {',
      '        [TestMethod] public void Inner() { }',
      '    }',
      '}',
    ].join('\n');
    const parsed = parseCSharpTests(src);
    const tests = parsed.declarations.filter(d => d.kind === 'test').map(d => d.path.join('.'));
    assert.deepStrictEqual(tests, [
      'My.App.Tests.ParserTests.Parses',
      'My.App.Tests.ParserTests.Cases',
      'My.App.Tests.ParserTests.Qualified',
      'My.App.Tests.ParserTests.Nested.Inner',
    ]);
    const inSetup = declarationAt(parsed, { line: lineOf(src, 'Parser.Reset'), character: 35 });
    assert.strictEqual(inSetup?.kind, 'suite');
    assert.strictEqual(inSetup?.name, 'ParserTests');
  });

  it('is not confused by braces in strings, generic methods or properties with attributes', () => {
    const src = [
      'public class T',
      '{',
      '    [JsonIgnore] public string Name { get; set; }',
      '    [Fact]',
      '    public void Braces() { var s = "}}}"; var t = $"{{{s}}}"; }',
      '    [Fact]',
      '    public void Generic<TValue>() where TValue : class { }',
      '}',
    ].join('\n');
    const tests = parseCSharpTests(src).declarations.filter(d => d.kind === 'test');
    assert.deepStrictEqual(tests.map(t => t.name), ['Braces', 'Generic']);
    assert.strictEqual(tests[0].range.end.line, 4);
  });

  it('supports additional test attributes', () => {
    const src = 'class C { [MyCustomTest] public void Custom() { } }';
    assert.strictEqual(parseCSharpTests(src).declarations.filter(d => d.kind === 'test').length, 0);
    const custom = parseCSharpTests(src, { testAttributes: ['MyCustomTest'] });
    assert.deepStrictEqual(custom.declarations.filter(d => d.kind === 'test').map(d => d.name), ['Custom']);
  });
});
