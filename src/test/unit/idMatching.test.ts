import * as assert from 'assert';
import { matchTestId } from '../../core/idMatching';
import { TestDeclaration } from '../../core/types';

const zero = { line: 0, character: 0 };
const decl = (path: string[], kind: TestDeclaration['kind'] = 'test'): TestDeclaration => ({
  kind,
  name: path[path.length - 1],
  path,
  range: { start: zero, end: zero },
  nameRange: { start: zero, end: zero },
});

describe('matchTestId', () => {
  it('matches fully qualified .NET names and prefers the method over its data rows', () => {
    const candidates = [
      ['dotnet', 'Calc.Tests', 'Calc.Tests.CalculatorTests', 'Calc.Tests.CalculatorTests.Add'],
      ['dotnet', 'Calc.Tests', 'Calc.Tests.CalculatorTests', 'Calc.Tests.CalculatorTests.Add', 'Calc.Tests.CalculatorTests.Add(a: 1, b: 2)'],
      ['dotnet', 'Calc.Tests', 'Calc.Tests.CalculatorTests', 'Calc.Tests.CalculatorTests.AddMany'],
    ];
    assert.deepStrictEqual(matchTestId(decl(['Calc.Tests', 'CalculatorTests', 'Add']), candidates), candidates[0]);
    assert.deepStrictEqual(matchTestId(decl(['Calc.Tests', 'CalculatorTests', 'AddMany']), candidates), candidates[2]);
  });

  it('matches suite-path style JS IDs and disambiguates by describe block', () => {
    const candidates = [
      ['jest', '/repo/src/calc.test.ts', '/repo/src/calc.test.ts#add', '/repo/src/calc.test.ts#add#works'],
      ['jest', '/repo/src/calc.test.ts', '/repo/src/calc.test.ts#sub', '/repo/src/calc.test.ts#sub#works'],
    ];
    assert.deepStrictEqual(matchTestId(decl(['sub', 'works']), candidates), candidates[1]);
    assert.deepStrictEqual(matchTestId(decl(['add', 'works']), candidates), candidates[0]);
  });

  it('matches plain title segments (mocha / node:test style)', () => {
    const candidates = [
      ['mocha', 'file:///repo/test/a.test.js', 'Array', 'Array#indexOf()', 'should return -1 when missing'],
    ];
    assert.deepStrictEqual(
      matchTestId(decl(['Array', '#indexOf()', 'should return -1 when missing']), candidates),
      candidates[0],
    );
    assert.deepStrictEqual(matchTestId(decl(['Array'], 'suite'), candidates.map(c => c.slice(0, 3))), candidates[0].slice(0, 3));
  });

  it('does not match partial words', () => {
    const candidates = [['c', 'Tests.AddMany']];
    assert.strictEqual(matchTestId(decl(['Add']), candidates), undefined);
    assert.strictEqual(matchTestId(decl(['Many']), candidates), undefined);
  });

  it('returns undefined when IDs carry no names (hash-based controllers)', () => {
    const candidates = [['vitest', 'a1b2c3', 'a1b2c3_0'], ['vitest', 'a1b2c3', 'a1b2c3_1']];
    assert.strictEqual(matchTestId(decl(['suite', 'adds']), candidates), undefined);
  });
});
