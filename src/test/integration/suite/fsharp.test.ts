import * as assert from 'assert';
import * as vscode from 'vscode';
import type { WhatTheTestApi } from '../../../extension';

const workspace = () => vscode.workspace.workspaceFolders![0].uri;
const sourceUri = () => vscode.Uri.joinPath(workspace(), 'src/Calc/Calculator.fs');
const xunitUri = () => vscode.Uri.joinPath(workspace(), 'tests/Calc.Tests/CalculatorTests.fs');
const expectoUri = () => vscode.Uri.joinPath(workspace(), 'tests/Calc.ExpectoTests/StringsTests.fs');

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

suite('What the Test (F#)', () => {
  let api: WhatTheTestApi;

  suiteSetup(async function () {
    this.timeout(300_000);
    const ext = vscode.extensions.getExtension<WhatTheTestApi>('AndrewBenz.what-the-test')!;
    api = await ext.activate();
    await vscode.window.showTextDocument(sourceUri());
    // Wait for FsAutoComplete to load the solution and see calls from both test projects.
    const line = await lineOf(sourceUri(), 'member this.Sum');
    await waitFor('F# call hierarchy', async () => {
      const [item] = await vscode.commands.executeCommand<vscode.CallHierarchyItem[]>(
        'vscode.prepareCallHierarchy', sourceUri(), new vscode.Position(line, 16)) ?? [];
      const calls = item && await vscode.commands.executeCommand<vscode.CallHierarchyIncomingCall[]>('vscode.provideIncomingCalls', item);
      return calls?.some(c => c.from.uri.path.endsWith('StringsTests.fs')) ? calls : undefined;
    }, 280_000);
  });

  test('finds xUnit tests for a line of F#', async () => {
    const doc = await vscode.workspace.openTextDocument(sourceUri());
    const result = await waitFor('covering tests', async () => {
      const r = await api.findTestsForLine(doc, await lineOf(sourceUri(), 'a + b'));
      return r.tests.length >= 3 ? r : undefined;
    }, 60_000);
    assert.strictEqual(result.symbolName, 'Add');
    assert.deepStrictEqual(result.tests.map(t => [t.declaration.path.join(' > '), t.distance, t.via.join(',')]), [
      ['Calc.Tests > CalculatorTests > Add returns the sum', 1, ''],
      ['strings > sums > sums with the calculator', 2, 'Sum'],
      ['Calc.Tests > CalculatorTests > Sum adds all values', 2, 'Sum'],
    ]);
  });

  test('finds Expecto tests for a line of F#', async () => {
    const doc = await vscode.workspace.openTextDocument(sourceUri());
    const result = await api.findTestsForLine(doc, await lineOf(sourceUri(), 'ToUpperInvariant'));
    assert.deepStrictEqual(result.tests.map(t => t.declaration.path.join(' > ')), ['strings > shouts']);
  });

  test('reports no tests for uncovered F#', async () => {
    const doc = await vscode.workspace.openTextDocument(sourceUri());
    const result = await api.findTestsForLine(doc, await lineOf(sourceUri(), 'nobody calls me'));
    assert.strictEqual(result.tests.length, 0);
  });

  test('lists no tests for a line inside an F# test', async () => {
    for (const [uri, needle, name] of [
      [xunitUri(), 'Calculator().Add(1, 2)', 'Add returns the sum'],
      [expectoUri(), 'Strings.shout "hi"', 'shouts'],
    ] as const) {
      const doc = await vscode.workspace.openTextDocument(uri);
      const result = await api.findTestsForLine(doc, await lineOf(uri, needle));
      assert.strictEqual(result.enclosingTest?.name, name);
    }
  });
});
