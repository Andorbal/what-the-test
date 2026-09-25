import * as assert from 'assert';
import * as vscode from 'vscode';
import type { WhatTheTestApi } from '../../../extension';

const workspace = () => vscode.workspace.workspaceFolders![0].uri;
const sourceUri = () => vscode.Uri.joinPath(workspace(), 'src/Calc/Calculator.cs');
const testUri = () => vscode.Uri.joinPath(workspace(), 'tests/Calc.Tests/CalculatorTests.cs');

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

suite('What the Test (C#)', () => {
  let api: WhatTheTestApi;

  suiteSetup(async function () {
    this.timeout(300_000);
    const ext = vscode.extensions.getExtension<WhatTheTestApi>('andorbal.what-the-test')!;
    api = await ext.activate();
    await vscode.window.showTextDocument(sourceUri());
    await vscode.workspace.openTextDocument(testUri());
    // Wait for Roslyn to load the solution and find references across projects.
    const line = await lineOf(sourceUri(), 'public int Add');
    await waitFor('Roslyn references', async () => {
      const refs = await vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeReferenceProvider', sourceUri(), new vscode.Position(line, 15));
      return refs?.some(r => r.uri.path.endsWith('CalculatorTests.cs')) ? refs : undefined;
    }, 280_000);
  });

  test('finds direct and indirect tests for a line of C#', async () => {
    const doc = await vscode.workspace.openTextDocument(sourceUri());
    const result = await waitFor('covering tests', async () => {
      const r = await api.findTestsForLine(doc, await lineOf(sourceUri(), 'return a + b'));
      return r.tests.length >= 2 ? r : undefined;
    }, 60_000);
    assert.strictEqual(result.symbolName, 'Add');
    assert.deepStrictEqual(result.tests.map(t => [t.declaration.path.join('.'), t.distance, t.via.join(',')]), [
      ['Calc.Tests.CalculatorTests.Add_ReturnsSum', 1, ''],
      ['Calc.Tests.CalculatorTests.Sum_AddsAllValues', 2, 'Calculator.Sum'],
    ]);
  });

  test('reports no tests for uncovered C#', async () => {
    const doc = await vscode.workspace.openTextDocument(sourceUri());
    const result = await api.findTestsForLine(doc, await lineOf(sourceUri(), 'nobody calls me'));
    assert.strictEqual(result.tests.length, 0);
  });

  test('reports the IDs of real .NET test items when a test controller is present', async function () {
    // Informational: logs the ID format of whichever .NET test controller is installed.
    this.timeout(200_000);
    const hasController = !!vscode.extensions.getExtension('ms-dotnettools.csdevkit');
    if (hasController) {
      // C# Dev Kit discovers tests after building; ask for a refresh.
      await vscode.commands.executeCommand('testing.refreshTests').then(undefined, () => undefined);
    }
    const ids = await waitFor('test discovery', async () => {
      const found = await vscode.commands.executeCommand<string[][]>('vscode.testing.getTestsInFile', testUri());
      return found?.length || !hasController ? found ?? [] : undefined;
    }, 180_000).catch(() => []);
    console.log('[csharp] test IDs in CalculatorTests.cs:', JSON.stringify(ids));
    if (!ids?.length) {
      this.skip();
    }
  });
});
