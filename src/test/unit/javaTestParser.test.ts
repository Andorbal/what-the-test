import * as assert from 'assert';
import { declarationAt } from '../../core/types';
import { parseJavaTests } from '../../languages/java/javaTestParser';

const lineOf = (text: string, needle: string) => text.split('\n').findIndex(l => l.includes(needle));
const at = (text: string, needle: string) => ({ line: lineOf(text, needle), character: text.split('\n')[lineOf(text, needle)].indexOf(needle) });

describe('parseJavaTests', () => {
  it('finds JUnit 5 tests, nested classes and setup', () => {
    const src = [
      'package com.example.calc;',
      '',
      'import org.junit.jupiter.api.*;',
      '',
      '@DisplayName("Calculator")',
      'class CalculatorTest {',
      '    private final Calculator calculator;',
      '',
      '    CalculatorTest() {',
      '        calculator = new Calculator();',
      '    }',
      '',
      '    @BeforeEach',
      '    void setUp() throws Exception {',
      '        calculator.reset();',
      '    }',
      '',
      '    @Test',
      '    @DisplayName("adds two numbers")',
      '    void addsTwoNumbers() {',
      '        assertEquals(3, calculator.add(1, 2));',
      '    }',
      '',
      '    @ParameterizedTest(name = "{0} + 0")',
      '    @ValueSource(ints = {1, 2, 3})',
      '    void addsZero(@ForAll int value) {',
      '        assertEquals(value, calculator.add(value, 0));',
      '    }',
      '',
      '    private int helper(@Mock Foo foo) {',
      '        return 1;',
      '    }',
      '',
      '    @Nested',
      '    class Sums {',
      '        @org.junit.jupiter.api.Test',
      '        public <T> void sumsAList() {',
      '            assertEquals(6, calculator.sum(List.of(1, 2, 3)));',
      '        }',
      '    }',
      '}',
    ].join('\n');
    const parsed = parseJavaTests(src);
    assert.deepStrictEqual(parsed.declarations.map(d => [d.kind, d.path.join('.')]), [
      ['suite', 'com.example.calc.CalculatorTest'],
      ['test', 'com.example.calc.CalculatorTest.addsTwoNumbers'],
      ['test', 'com.example.calc.CalculatorTest.addsZero'],
      ['suite', 'com.example.calc.CalculatorTest.Sums'],
      ['test', 'com.example.calc.CalculatorTest.Sums.sumsAList'],
    ]);
    const adds = parsed.declarations[1];
    assert.deepStrictEqual([adds.range.start.line, adds.range.end.line], [lineOf(src, '    @Test'), lineOf(src, 'assertEquals(3') + 1]);
    assert.deepStrictEqual(adds.nameRange.start, at(src, 'addsTwoNumbers'));
    const find = (needle: string) => declarationAt(parsed, at(src, needle))?.name;
    assert.strictEqual(find('calculator.reset()'), 'CalculatorTest');
    assert.strictEqual(find('calculator = new Calculator()'), 'CalculatorTest');
    assert.strictEqual(find('calculator.sum('), 'sumsAList');
    assert.strictEqual(find('return 1;'), undefined);
  });

  it('finds JUnit 4 and TestNG tests and ignores annotations in strings and comments', () => {
    const src = [
      'public class LegacyTest {',
      '    @Before public void init() { setup(); }',
      '    @Test(expected = IllegalStateException.class)',
      '    public void throwsWhenEmpty() { run(); }',
      '    // @Test void commented() {}',
      '    String s = "@Test void inString() {}";',
      '    String block = """',
      '        @Test void inTextBlock() {}',
      '        """;',
      '}',
    ].join('\n');
    const parsed = parseJavaTests(src);
    assert.deepStrictEqual(parsed.declarations.map(d => d.path.join('.')), ['LegacyTest', 'LegacyTest.throwsWhenEmpty']);
    assert.strictEqual(declarationAt(parsed, at(src, 'setup()'))?.name, 'LegacyTest');
  });
});
