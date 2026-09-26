import * as assert from 'assert';
import * as vscode from 'vscode';
import { matchTestId } from '../../../core/idMatching';
import type { WhatTheTestApi } from '../../../extension';

const workspace = () => vscode.workspace.workspaceFolders![0].uri;
const main = (file: string) => vscode.Uri.joinPath(workspace(), 'src/main/java/com/example/calc', file);
const testUri = () => vscode.Uri.joinPath(workspace(), 'src/test/java/com/example/calc/CalculatorTest.java');

async function lineOf(uri: vscode.Uri, needle: string): Promise<number> {
  const doc = await vscode.workspace.openTextDocument(uri);
  const line = doc.getText().split('\n').findIndex(l => l.includes(needle));
  assert.ok(line >= 0, `'${needle}' not found`);
  return line;
}

async function waitFor<T>(what: string, fn: () => Promise<T | undefined>, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${what}`);
    }
    await new Promise(r => setTimeout(r, 1000));
  }
}

suite('What the Test (Java)', () => {
  let api: WhatTheTestApi;

  suiteSetup(async function () {
    this.timeout(400_000);
    const ext = vscode.extensions.getExtension<WhatTheTestApi>('AndrewBenz.what-the-test')!;
    api = await ext.activate();
    await vscode.window.showTextDocument(main('Calculator.java'));
    // Wait for the Java language server to import the Maven project.
    const line = await lineOf(main('Calculator.java'), 'public int add');
    await waitFor('Java call hierarchy', async () => {
      const [item] = await vscode.commands.executeCommand<vscode.CallHierarchyItem[]>(
        'vscode.prepareCallHierarchy', main('Calculator.java'), new vscode.Position(line, 16)).then(x => x, () => []) ?? [];
      const calls = item && await vscode.commands.executeCommand<vscode.CallHierarchyIncomingCall[]>('vscode.provideIncomingCalls', item);
      return calls?.some(c => c.from.uri.path.endsWith('CalculatorTest.java')) ? calls : undefined;
    }, 380_000);
  });

  test('finds JUnit tests, including nested classes, for a line of Java', async () => {
    const doc = await vscode.workspace.openTextDocument(main('Calculator.java'));
    const result = await api.findTestsForLine(doc, await lineOf(main('Calculator.java'), 'return a + b'));
    assert.strictEqual(result.symbolName, 'add');
    assert.deepStrictEqual(result.tests.map(t => [t.declaration.path.slice(1).join('.'), t.distance, t.via.join(',')]), [
      ['CalculatorTest.addsTwoNumbers', 1, ''],
      ['CalculatorTest.addsZero', 1, ''],
      ['CalculatorTest.Sums.sumsAList', 2, 'sum'],
    ]);
  });

  test('follows calls through interfaces in Java', async () => {
    // Square.area is called directly only by the untested isLarge; the Java
    // language server's call hierarchy includes the call through Shape::area.
    const doc = await vscode.workspace.openTextDocument(main('Square.java'));
    const result = await api.findTestsForLine(doc, await lineOf(main('Square.java'), 'return side * side'));
    assert.deepStrictEqual(result.tests.map(t => [t.declaration.name, t.via.join(',')]), [['addsUpAreas', 'totalArea']]);
  });

  test('reports no tests for uncovered Java', async () => {
    const doc = await vscode.workspace.openTextDocument(main('Calculator.java'));
    const result = await api.findTestsForLine(doc, await lineOf(main('Calculator.java'), 'nobody calls me'));
    assert.strictEqual(result.tests.length, 0);
  });

  test('treats @BeforeEach as setup for the class', async () => {
    const doc = await vscode.workspace.openTextDocument(testUri());
    const result = await api.findTestsForLine(doc, await lineOf(testUri(), 'calculator = new Calculator()'));
    assert.strictEqual(result.enclosingTest?.name, 'CalculatorTest');
  });

  test('matches tests to the Java Test Runner\'s test items', async function () {
    this.timeout(300_000);
    // The Java Test Runner lists a file's tests once it has been opened in an editor.
    await vscode.window.showTextDocument(testUri());
    await vscode.commands.executeCommand('testing.refreshTests').then(undefined, () => undefined);
    const ids = await waitFor('Java test items', async () => {
      const found = await vscode.commands.executeCommand<string[][]>('vscode.testing.getTestsInFile', testUri());
      return found?.some(id => id[id.length - 1].includes('#')) ? found : undefined;
    }, 280_000);
    const doc = await vscode.workspace.openTextDocument(main('Calculator.java'));
    const result = await api.findTestsForLine(doc, await lineOf(main('Calculator.java'), 'return a + b'));
    assert.deepStrictEqual(result.tests.map(t => matchTestId(t.declaration, ids)?.at(-1)), [
      'calc@com.example.calc.CalculatorTest#addsTwoNumbers()',
      'calc@com.example.calc.CalculatorTest#addsZero(int)',
      'calc@com.example.calc.CalculatorTest$Sums#sumsAList()',
    ]);
  });
});
