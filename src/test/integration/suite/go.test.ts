import * as assert from 'assert';
import * as vscode from 'vscode';
import type { WhatTheTestApi } from '../../../extension';
import { GoAdapter } from '../../../languages/go/goAdapter';

const workspace = () => vscode.workspace.workspaceFolders![0].uri;
const sourceUri = () => vscode.Uri.joinPath(workspace(), 'calc/calculator.go');
const shapesUri = () => vscode.Uri.joinPath(workspace(), 'calc/shapes.go');
const testUri = () => vscode.Uri.joinPath(workspace(), 'calc/calculator_test.go');

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

suite('What the Test (Go)', () => {
  let api: WhatTheTestApi;

  suiteSetup(async function () {
    this.timeout(300_000);
    const ext = vscode.extensions.getExtension<WhatTheTestApi>('AndrewBenz.what-the-test')!;
    api = await ext.activate();
    await vscode.window.showTextDocument(sourceUri());
    const line = await lineOf(sourceUri(), 'func Add');
    await waitFor('gopls call hierarchy', async () => {
      const [item] = await vscode.commands.executeCommand<vscode.CallHierarchyItem[]>(
        'vscode.prepareCallHierarchy', sourceUri(), new vscode.Position(line, 5)).then(x => x, () => []) ?? [];
      const calls = item && await vscode.commands.executeCommand<vscode.CallHierarchyIncomingCall[]>('vscode.provideIncomingCalls', item);
      return calls?.some(c => c.from.uri.path.endsWith('_test.go')) ? calls : undefined;
    }, 280_000);
  });

  test('finds tests and subtests for a line of Go', async () => {
    const doc = await vscode.workspace.openTextDocument(sourceUri());
    const result = await api.findTestsForLine(doc, await lineOf(sourceUri(), 'return a + b'));
    assert.strictEqual(result.symbolName, 'Add');
    assert.deepStrictEqual(result.tests.map(t => [t.declaration.path.join('/'), t.distance, t.via.join(',')]), [
      ['TestAdd', 1, ''],
      ['TestSum/empty', 2, 'Sum'],
      ['TestSum/several_values', 2, 'Sum'],
    ]);
  });

  test('follows calls through interfaces in Go', async () => {
    const doc = await vscode.workspace.openTextDocument(shapesUri());
    const result = await api.findTestsForLine(doc, await lineOf(shapesUri(), 's.Side * s.Side'));
    assert.strictEqual(result.symbolName, 'Square.Area');
    assert.deepStrictEqual(result.tests.map(t => [t.declaration.name, t.via.join(',')]), [['TestTotalArea', 'TotalArea']]);
  });

  test('reports no tests for uncovered Go', async () => {
    const doc = await vscode.workspace.openTextDocument(sourceUri());
    const result = await api.findTestsForLine(doc, await lineOf(sourceUri(), 'nobody calls me'));
    assert.strictEqual(result.tests.length, 0);
  });

  test('lists no tests for a line inside a subtest', async () => {
    const doc = await vscode.workspace.openTextDocument(testUri());
    const result = await api.findTestsForLine(doc, await lineOf(testUri(), 'Sum(1, 2, 3)'));
    assert.strictEqual(result.enclosingTest?.name, 'several_values');
  });

  test('matches tests and subtests to the Go extension\'s test items', async () => {
    const doc = await vscode.workspace.openTextDocument(testUri());
    const ids = await waitFor('Go test items', async () => {
      const found = await vscode.commands.executeCommand<string[][]>('vscode.testing.getTestsInFile', testUri());
      return found?.some(id => id[id.length - 1].endsWith('#TestSum')) ? found : undefined;
    }, 60_000);
    const adapter = new GoAdapter();
    const parsed = adapter.parseTests(doc);
    const idOf = (path: string) => {
      const decl = parsed.declarations.find(d => d.path.join('/') === path)!;
      return adapter.matchTestId(decl, ids)?.at(-1)?.split('#').pop();
    };
    assert.strictEqual(idOf('TestAdd'), 'TestAdd');
    // Subtests only get test items once they have run; until then their parent runs.
    assert.match(idOf('TestSum/several_values')!, /^TestSum(\/several_values)?$/);
  });
});
