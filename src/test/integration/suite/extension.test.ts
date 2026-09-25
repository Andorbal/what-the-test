import * as assert from 'assert';
import * as vscode from 'vscode';
import type { WhatTheTestApi } from '../../../extension';

const workspace = () => vscode.workspace.workspaceFolders![0].uri;
const sourceUri = () => vscode.Uri.joinPath(workspace(), 'src/calculator.ts');
const testUri = () => vscode.Uri.joinPath(workspace(), 'test/calculator.test.ts');

async function lineOf(uri: vscode.Uri, needle: string): Promise<number> {
  const doc = await vscode.workspace.openTextDocument(uri);
  const line = doc.getText().split('\n').findIndex(l => l.includes(needle));
  assert.ok(line >= 0, `'${needle}' not found`);
  return line;
}

async function waitFor<T>(what: string, fn: () => Promise<T | undefined>, timeoutMs = 60_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${what}`);
    }
    await new Promise(r => setTimeout(r, 250));
  }
}

async function placeCursor(uri: vscode.Uri, line: number): Promise<void> {
  const editor = await vscode.window.showTextDocument(uri);
  const pos = new vscode.Position(line, editor.document.lineAt(line).firstNonWhitespaceCharacterIndex);
  editor.selection = new vscode.Selection(pos, pos);
}

/**
 * Builds a test controller mirroring the fixture's test file, standing in for
 * a real one such as the Jest or Mocha extension. `idFor` decides the ID
 * scheme; ranges are provided so "Run Test at Cursor" works as well.
 */
async function createFakeController(id: string, idFor: (path: string[]) => string) {
  const controller = vscode.tests.createTestController(id, id);
  const uri = testUri();
  const doc = await vscode.workspace.openTextDocument(uri);
  const lines = doc.getText().split('\n');
  const rangeOf = (needle: string) => {
    const line = lines.findIndex(l => l.includes(needle));
    return new vscode.Range(line, 0, line, lines[line].length);
  };

  const file = controller.createTestItem(idFor([]), 'calculator.test.ts', uri);
  const root = controller.createTestItem(idFor(['calculator']), 'calculator', uri);
  root.range = rangeOf("describe('calculator'");
  const add = controller.createTestItem(idFor(['calculator', 'add']), 'add', uri);
  add.range = rangeOf("describe('add'");
  const addTest = controller.createTestItem(idFor(['calculator', 'add', 'adds two numbers']), 'adds two numbers', uri);
  addTest.range = rangeOf("it('adds two numbers'");
  const sum = controller.createTestItem(idFor(['calculator', 'sum']), 'sum', uri);
  sum.range = rangeOf("describe('sum'");
  const sumTest = controller.createTestItem(idFor(['calculator', 'sum', 'sums a list']), 'sums a list', uri);
  sumTest.range = rangeOf("it('sums a list'");
  add.children.add(addTest);
  sum.children.add(sumTest);
  root.children.add(add);
  root.children.add(sum);
  file.children.add(root);
  controller.items.add(file);

  const ran: string[] = [];
  let onRan: (() => void) | undefined;
  controller.createRunProfile('Run', vscode.TestRunProfileKind.Run, (request, _token) => {
    const run = controller.createTestRun(request);
    for (const test of request.include ?? []) {
      ran.push(test.label);
      run.passed(test);
    }
    run.end();
    onRan?.();
  }, true);

  return {
    controller,
    ran,
    /** Resolves after `count` run requests have completed. */
    waitForRuns: (count: number) => new Promise<void>(resolve => {
      let seen = 0;
      onRan = () => {
        if (++seen >= count) {
          resolve();
        }
      };
    }),
  };
}

suite('What the Test', () => {
  let api: WhatTheTestApi;

  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension<WhatTheTestApi>('andorbal.what-the-test')!;
    api = await ext.activate();
    // Wait for the TypeScript language server to be ready.
    const line = await lineOf(sourceUri(), 'export function add');
    await waitFor('TypeScript call hierarchy', async () => {
      const items = await vscode.commands.executeCommand<vscode.CallHierarchyItem[]>(
        'vscode.prepareCallHierarchy', sourceUri(), new vscode.Position(line, 17));
      return items?.length ? items : undefined;
    }, 120_000);
  });

  test('finds direct and indirect tests for a line', async () => {
    const doc = await vscode.workspace.openTextDocument(sourceUri());
    const result = await waitFor('covering tests', async () => {
      const r = await api.findTestsForLine(doc, await lineOf(sourceUri(), 'return a + b'));
      return r.tests.length >= 2 ? r : undefined;
    });
    assert.strictEqual(result.symbolName, 'add');
    assert.deepStrictEqual(result.tests.map(t => t.declaration.path.join(' > ')), [
      'calculator > add > adds two numbers',
      'calculator > sum > sums a list',
    ]);
    assert.deepStrictEqual(result.tests.map(t => t.distance), [1, 2]);
    assert.deepStrictEqual(result.tests[1].via, ['sum']);
  });

  test('walks through class methods and helpers in test files', async () => {
    const uri = vscode.Uri.joinPath(workspace(), 'src/greeter.ts');
    const doc = await vscode.workspace.openTextDocument(uri);
    const decorate = await api.findTestsForLine(doc, await lineOf(uri, 'value.toUpperCase()'));
    assert.deepStrictEqual(decorate.tests.map(t => [t.declaration.name, t.via.join(',')]), [['greets loudly', 'greet']]);

    // The constructor is only called from a helper function in the test file.
    assert.strictEqual(decorate.symbolName, 'decorate');
    const ctor = await api.findTestsForLine(doc, await lineOf(uri, 'constructor('));
    assert.deepStrictEqual(ctor.tests.map(t => [t.declaration.name, t.via.join(',')]), [['greets loudly', 'makeGreeter']]);
  });

  test('reports no tests for uncovered code', async () => {
    const doc = await vscode.workspace.openTextDocument(sourceUri());
    const result = await api.findTestsForLine(doc, await lineOf(sourceUri(), 'nobody calls me'));
    assert.strictEqual(result.tests.length, 0);
  });

  test('a line inside a test is covered by that test', async () => {
    const doc = await vscode.workspace.openTextDocument(testUri());
    const result = await api.findTestsForLine(doc, await lineOf(testUri(), 'sum([1, 2, 3])'));
    assert.deepStrictEqual(result.tests.map(t => t.declaration.name), ['sums a list']);
    assert.strictEqual(result.tests[0].distance, 0);
  });

  test('runs all covering tests by ID through the Testing API', async () => {
    const fake = await createFakeController('fake-by-id', path => [testUri().toString(), ...path].join('#'));
    try {
      await placeCursor(sourceUri(), await lineOf(sourceUri(), 'return a + b'));
      const done = fake.waitForRuns(1);
      await vscode.commands.executeCommand('whatTheTest.runTestsForLine');
      await done;
      assert.deepStrictEqual([...fake.ran].sort(), ['adds two numbers', 'sums a list']);
    } finally {
      fake.controller.dispose();
    }
  });

  test('falls back to "Run Test at Cursor" when IDs carry no names', async () => {
    let n = 0;
    const ids = new Map<string, string>();
    const fake = await createFakeController('fake-hashed', path => {
      const key = path.join('/');
      if (!ids.has(key)) {
        ids.set(key, `h${n++}`);
      }
      return ids.get(key)!;
    });
    try {
      const line = await lineOf(sourceUri(), 'return a + b');
      await placeCursor(sourceUri(), line);
      const done = fake.waitForRuns(2);
      await vscode.commands.executeCommand('whatTheTest.runTestsForLine');
      await done;
      assert.deepStrictEqual([...fake.ran].sort(), ['adds two numbers', 'sums a list']);
      // The user is returned to where they were.
      assert.strictEqual(vscode.window.activeTextEditor?.document.uri.toString(), sourceUri().toString());
      assert.strictEqual(vscode.window.activeTextEditor?.selection.active.line, line);
    } finally {
      fake.controller.dispose();
    }
  });

  test('runs a single test via the command used by the UI', async () => {
    const fake = await createFakeController('fake-single', path => ['single', ...path].join('.'));
    try {
      const doc = await vscode.workspace.openTextDocument(sourceUri());
      const result = await api.findTestsForLine(doc, await lineOf(sourceUri(), 'return a + b'));
      const done = fake.waitForRuns(1);
      await vscode.commands.executeCommand('whatTheTest.runTest', result.tests[1]);
      await done;
      assert.deepStrictEqual(fake.ran, ['sums a list']);
    } finally {
      fake.controller.dispose();
    }
  });

  test('goes to a test', async () => {
    const doc = await vscode.workspace.openTextDocument(sourceUri());
    const result = await api.findTestsForLine(doc, await lineOf(sourceUri(), 'return a + b'));
    await vscode.commands.executeCommand('whatTheTest.goToTest', result.tests[0]);
    const editor = vscode.window.activeTextEditor!;
    assert.strictEqual(editor.document.uri.toString(), testUri().toString());
    assert.strictEqual(editor.document.getText(editor.selection), 'adds two numbers');
  });
});
