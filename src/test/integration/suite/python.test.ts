import * as assert from 'assert';
import * as vscode from 'vscode';
import { matchTestId } from '../../../core/idMatching';
import type { WhatTheTestApi } from '../../../extension';

const workspace = () => vscode.workspace.workspaceFolders![0].uri;
const sourceUri = () => vscode.Uri.joinPath(workspace(), 'calc/calculator.py');
const testUri = () => vscode.Uri.joinPath(workspace(), 'tests/test_calculator.py');

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
    await new Promise(r => setTimeout(r, 500));
  }
}

suite('What the Test (Python)', () => {
  let api: WhatTheTestApi;

  suiteSetup(async function () {
    this.timeout(300_000);
    const ext = vscode.extensions.getExtension<WhatTheTestApi>('AndrewBenz.what-the-test')!;
    api = await ext.activate();
    await vscode.window.showTextDocument(sourceUri());
    // Wait for Pylance to resolve calls made through the (typed) pytest fixture.
    const line = await lineOf(sourceUri(), 'def add');
    await waitFor('Pylance call hierarchy', async () => {
      const [item] = await vscode.commands.executeCommand<vscode.CallHierarchyItem[]>(
        'vscode.prepareCallHierarchy', sourceUri(), new vscode.Position(line, 8)) ?? [];
      const calls = item && await vscode.commands.executeCommand<vscode.CallHierarchyIncomingCall[]>('vscode.provideIncomingCalls', item);
      return calls?.filter(c => c.from.uri.path.endsWith('test_calculator.py')).length === 2 ? calls : undefined;
    }, 280_000);
  });

  test('finds pytest and unittest tests for a line of Python', async () => {
    const doc = await vscode.workspace.openTextDocument(sourceUri());
    const result = await api.findTestsForLine(doc, await lineOf(sourceUri(), 'return a + b'));
    assert.strictEqual(result.symbolName, 'add');
    assert.deepStrictEqual(result.tests.map(t => [t.declaration.path.join('::'), t.distance, t.via.join(',')]), [
      ['test_add', 1, ''],
      ['CalculatorTestCase::test_add', 1, ''],
      ['test_sum', 2, 'sum'],
    ]);
  });

  test('follows pytest fixtures and unittest setUp', async () => {
    // Calculator() is only called by the `calculator` fixture and by setUp.
    const doc = await vscode.workspace.openTextDocument(sourceUri());
    const result = await api.findTestsForLine(doc, await lineOf(sourceUri(), 'self.history = []'));
    assert.deepStrictEqual(result.tests.map(t => [t.declaration.kind, t.declaration.path.join('::'), t.via.join(',')]), [
      ['suite', 'CalculatorTestCase', ''],
      ['test', 'test_add', 'calculator'],
      ['test', 'test_sum', 'calculator'],
    ]);
  });

  test('reports no tests for uncovered Python', async () => {
    const doc = await vscode.workspace.openTextDocument(sourceUri());
    const result = await api.findTestsForLine(doc, await lineOf(sourceUri(), 'nobody calls me'));
    assert.strictEqual(result.tests.length, 0);
  });

  test('lists no tests for a line inside a Python test', async () => {
    const doc = await vscode.workspace.openTextDocument(testUri());
    const result = await api.findTestsForLine(doc, await lineOf(testUri(), 'shout("hi")'));
    assert.strictEqual(result.enclosingTest?.name, 'test_shouts');
  });

  test('matches tests to the Python extension\'s test items', async () => {
    await vscode.commands.executeCommand('testing.refreshTests');
    const ids = await waitFor('Python test items', async () => {
      const found = await vscode.commands.executeCommand<string[][]>('vscode.testing.getTestsInFile', testUri());
      return found?.length ? found : undefined;
    }, 120_000);
    const doc = await vscode.workspace.openTextDocument(sourceUri());
    const result = await api.findTestsForLine(doc, await lineOf(sourceUri(), 'return a + b'));
    const matched = result.tests.map(t => matchTestId(t.declaration, ids)?.at(-1)?.split('/').pop());
    assert.deepStrictEqual(matched, [
      'test_calculator.py::test_add',
      'test_calculator.py::CalculatorTestCase::test_add',
      'test_calculator.py::test_sum',
    ]);
  });
});
