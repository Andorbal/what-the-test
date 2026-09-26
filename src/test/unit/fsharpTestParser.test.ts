import * as assert from 'assert';
import { declarationAt } from '../../core/types';
import { maskFSharp } from '../../languages/fsharp/fsharpMask';
import { parseFSharpTests } from '../../languages/fsharp/fsharpTestParser';

const lineOf = (text: string, needle: string) => text.split('\n').findIndex(l => l.includes(needle));
const at = (text: string, needle: string) => ({ line: lineOf(text, needle), character: text.split('\n')[lineOf(text, needle)].indexOf(needle) });

describe('maskFSharp', () => {
  it('masks strings and comments but keeps double-backtick names and type parameters', () => {
    const src = [
      'let a = "[<Fact>]"',
      'let b = @"verbatim "" [<Fact>]"',
      'let c = $"interp {a} [<Fact>]"',
      'let d = """triple " [<Fact>]"""',
      "let e = '['",
      '// [<Fact>] comment',
      '(* [<Fact>] (* nested *) still comment *) let f = 1',
      "let ``[<Fact>] in a name`` (x: 'T) = (*) 2 3",
    ].join('\n');
    const masked = maskFSharp(src);
    assert.strictEqual(masked.length, src.length);
    assert.strictEqual(masked.split('[<Fact>]').length, 2, masked);
    assert.ok(masked.includes('``[<Fact>] in a name``'));
    assert.ok(masked.includes("(x: 'T) = (*) 2 3"));
    assert.ok(masked.includes('let f = 1'));
  });
});

describe('parseFSharpTests', () => {
  it('finds xUnit tests in a top-level module', () => {
    const src = [
      'module Calc.Tests.CalculatorTests',
      '',
      'open Xunit',
      '',
      'let calculator = Calculator()',
      '',
      '[<Fact>]',
      'let ``adds two numbers`` () =',
      '    Assert.Equal(3, calculator.Add(1, 2))',
      '',
      '[<Theory>]',
      '[<InlineData(1, 2, 3)>]',
      'let ``sums a list`` (a: int, b: int, expected: int) =',
      '    let total =',
      '        [ a; b ] |> List.sum',
      '    Assert.Equal(expected, total)',
      '',
      'let helper () = 42',
    ].join('\n');
    const { declarations } = parseFSharpTests(src);
    assert.deepStrictEqual(declarations.map(d => [d.kind, d.path.join(' > ')]), [
      ['suite', 'Calc.Tests > CalculatorTests'],
      ['test', 'Calc.Tests > CalculatorTests > adds two numbers'],
      ['test', 'Calc.Tests > CalculatorTests > sums a list'],
    ]);
    const sums = declarations[2];
    assert.deepStrictEqual([sums.range.start.line, sums.range.end.line], [lineOf(src, '[<Theory>]'), lineOf(src, 'Assert.Equal(expected')]);
    assert.deepStrictEqual(sums.nameRange.start, at(src, 'sums a list'));
    assert.strictEqual(declarationAt({ declarations, setupRegions: [] }, at(src, 'helper')), undefined);
  });

  it('finds NUnit tests and setup in a class inside a namespace', () => {
    const src = [
      'namespace Calc.Tests',
      '',
      'open NUnit.Framework',
      '',
      '[<TestFixture>]',
      'type CalculatorTests() =',
      '    let calculator = Calculator()',
      '    let twice f x = f (f x)',
      '',
      '    [<SetUp>]',
      '    member _.Reset() =',
      '        calculator.Clear()',
      '',
      '    [<Test>]',
      '    member this.``Add returns sum``() =',
      '        Assert.AreEqual(3, calculator.Add(1, 2))',
      '',
      '    [<TestCase(1, 2)>] member _.AddCase(a, b) = Assert.Pass()',
      '',
      '    interface System.IDisposable with',
      '        member _.Dispose() = calculator.Dispose()',
      '',
      'type NotATest() =',
      '    member _.Foo() = 1',
    ].join('\n');
    const parsed = parseFSharpTests(src);
    assert.deepStrictEqual(parsed.declarations.map(d => [d.kind, d.path.join(' > ')]), [
      ['suite', 'Calc.Tests > CalculatorTests'],
      ['test', 'Calc.Tests > CalculatorTests > Add returns sum'],
      ['test', 'Calc.Tests > CalculatorTests > AddCase'],
    ]);
    const suite = parsed.declarations[0];
    assert.deepStrictEqual([suite.range.start.line, suite.range.end.line], [lineOf(src, 'type CalculatorTests'), lineOf(src, 'member _.Dispose')]);
    const inSetup = (needle: string) => declarationAt(parsed, at(src, needle))?.name;
    assert.strictEqual(inSetup('calculator.Clear()'), 'CalculatorTests');
    assert.strictEqual(inSetup('let calculator'), 'CalculatorTests');
    assert.strictEqual(inSetup('calculator.Dispose()'), 'CalculatorTests');
    assert.strictEqual(inSetup('let twice'), undefined, 'a function is only run when called');
    assert.strictEqual(inSetup('member _.Foo'), undefined);
  });

  it('finds tests in nested modules', () => {
    const src = [
      'module Tests',
      '',
      'module Add =',
      '    [<Fact>]',
      '    let ``works`` () = ()',
      '',
      'module Sum =',
      '    [<Fact>]',
      '    let works () = ()',
    ].join('\n');
    assert.deepStrictEqual(parseFSharpTests(src).declarations.map(d => [d.kind, d.path.join(' > ')]), [
      ['suite', 'Tests > Add'],
      ['test', 'Tests > Add > works'],
      ['suite', 'Tests > Sum'],
      ['test', 'Tests > Sum > works'],
    ]);
  });

  it('finds Expecto test lists and tests', () => {
    const src = [
      'module CalculatorTests',
      '',
      'open Expecto',
      '',
      '[<Tests>]',
      'let tests =',
      '  testList "calculator" [',
      '    testCase "adds two numbers" <| fun _ ->',
      '      Expect.equal (add 1 2) 3 "sum"',
      '',
      '    testList "sum" [',
      '      test "sums a list" {',
      '        Expect.equal (sum [1; 2]) 3 "sum"',
      '      }',
      '      ptestCase "pending" <| fun _ -> ()',
      '    ]',
      '',
      '    testPropertyWithConfig config "is commutative" <| fun a b ->',
      '      add a b = add b a',
      '  ]',
      '',
      'let test = 42',
    ].join('\n');
    const parsed = parseFSharpTests(src);
    assert.deepStrictEqual(parsed.declarations.map(d => [d.kind, d.path.join(' > ')]), [
      ['suite', 'calculator'],
      ['test', 'calculator > adds two numbers'],
      ['suite', 'calculator > sum'],
      ['test', 'calculator > sum > sums a list'],
      ['test', 'calculator > sum > pending'],
      ['test', 'calculator > is commutative'],
    ]);
    const find = (needle: string) => declarationAt(parsed, at(src, needle))?.name;
    assert.strictEqual(find('Expect.equal (add'), 'adds two numbers');
    assert.strictEqual(find('Expect.equal (sum'), 'sums a list');
    assert.strictEqual(find('add a b = add b a'), 'is commutative');
    assert.strictEqual(find('let test = 42'), undefined);
    const sums = parsed.declarations[3];
    assert.strictEqual(sums.range.end.line, lineOf(src, '      }'));
  });

  it('ignores attributes that are not tests and tests inside strings or comments', () => {
    const src = [
      'module M',
      '[<Literal>]',
      'let Name = "[<Fact>] let x () = ()"',
      '// [<Fact>]',
      '// let commented () = ()',
      '[<Obsolete("no")>]',
      'let old () = ()',
    ].join('\n');
    assert.deepStrictEqual(parseFSharpTests(src).declarations, []);
  });

  it('supports custom test attributes', () => {
    const src = ['module M', '[<Scenario>]', 'let ``a scenario`` () = ()'].join('\n');
    assert.deepStrictEqual(parseFSharpTests(src).declarations.length, 0);
    assert.deepStrictEqual(parseFSharpTests(src, { testAttributes: ['Scenario'] }).declarations.map(d => d.name), ['M', 'a scenario']);
  });
});
