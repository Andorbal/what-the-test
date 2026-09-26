import * as assert from 'assert';
import * as vscode from 'vscode';
import type { LineTestsResult } from '../../../core/coveringTestFinder';
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
  // The items reach VS Code's test index asynchronously; until then the tests can't be found by ID.
  await waitFor(`${id}'s test items`, async () => {
    const ids = await vscode.commands.executeCommand<string[][]>('vscode.testing.getTestsInFile', uri);
    return ids?.some(parts => parts[0] === id && parts.length === 5) || undefined;
  }, 10_000);

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
    const ext = vscode.extensions.getExtension<WhatTheTestApi>('AndrewBenz.what-the-test')!;
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

  test('finds every test in a file that calls the line', async () => {
    // TypeScript reports the calls from both `it(...)` callbacks as one caller
    // (the test file) with two call sites.
    const uri = vscode.Uri.joinPath(workspace(), 'src/strings.ts');
    const doc = await vscode.workspace.openTextDocument(uri);
    const result = await waitFor('covering tests', async () => {
      const r = await api.findTestsForLine(doc, await lineOf(uri, 'toUpperCase()'));
      return r.tests.length ? r : undefined;
    });
    assert.deepStrictEqual(result.tests.map(t => t.declaration.name), ['upper-cases the text', 'adds an exclamation mark']);
  });

  test('follows calls through interfaces and base classes', async () => {
    const uri = vscode.Uri.joinPath(workspace(), 'src/shapes.ts');
    const doc = await vscode.workspace.openTextDocument(uri);
    const result = await waitFor('covering tests', async () => {
      const r = await api.findTestsForLine(doc, await lineOf(uri, 'this.side * this.side'));
      return r.tests.length >= 2 ? r : undefined;
    });
    assert.deepStrictEqual(result.tests.map(t => [t.declaration.name, t.via.join(',')]), [
      ['adds up areas', 'totalArea'],
      ['describes a polygon', 'describe'],
    ]);
  });

  test('reports no tests for uncovered code', async () => {
    const doc = await vscode.workspace.openTextDocument(sourceUri());
    const result = await api.findTestsForLine(doc, await lineOf(sourceUri(), 'nobody calls me'));
    assert.strictEqual(result.tests.length, 0);
  });

  test('lists no tests for a line inside a test', async () => {
    const doc = await vscode.workspace.openTextDocument(testUri());
    const result = await api.findTestsForLine(doc, await lineOf(testUri(), 'sum([1, 2, 3])'));
    assert.strictEqual(result.tests.length, 0);
    assert.strictEqual(result.enclosingTest?.name, 'sums a list');
  });

  test('lists the tests that use a helper in a test file', async () => {
    const uri = vscode.Uri.joinPath(workspace(), 'test/greeter.spec.ts');
    const doc = await vscode.workspace.openTextDocument(uri);
    const result = await api.findTestsForLine(doc, await lineOf(uri, "return new Greeter('world')"));
    assert.strictEqual(result.enclosingTest, undefined);
    assert.deepStrictEqual(result.tests.map(t => t.declaration.name), ['greets loudly']);
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

  test('keeps the list while going through its tests', async () => {
    const line = await lineOf(sourceUri(), 'return a + b');
    await placeCursor(sourceUri(), line);
    const result = await vscode.commands.executeCommand<LineTestsResult>('whatTheTest.refresh');
    assert.strictEqual(result.tests.length, 2);

    // Going to a listed test keeps the list for the original line...
    await vscode.commands.executeCommand('whatTheTest.goToTest', result.tests[1]);
    const held = await vscode.commands.executeCommand<LineTestsResult>('whatTheTest.refresh');
    assert.strictEqual(held.uri.toString(), sourceUri().toString());
    assert.strictEqual(held.line, line);
    assert.deepStrictEqual(held.tests.map(t => t.declaration.name), ['adds two numbers', 'sums a list']);

    // ...so "Run All" still runs all of them.
    const fake = await createFakeController('fake-held', path => ['held', ...path].join('.'));
    try {
      const done = fake.waitForRuns(1);
      await vscode.commands.executeCommand('whatTheTest.runTestsForLine');
      await done;
      assert.deepStrictEqual([...fake.ran].sort(), ['adds two numbers', 'sums a list']);
    } finally {
      fake.controller.dispose();
    }

    // Leaving the tests follows the cursor again.
    await placeCursor(testUri(), 0);
    const after = await vscode.commands.executeCommand<LineTestsResult>('whatTheTest.refresh');
    assert.strictEqual(after.uri.toString(), testUri().toString());
    assert.strictEqual(after.line, 0);
  });

  test('pins the list to a line', async () => {
    const line = await lineOf(sourceUri(), 'return a + b');
    await placeCursor(sourceUri(), line);
    await vscode.commands.executeCommand('whatTheTest.refresh');
    await vscode.commands.executeCommand('whatTheTest.pin');
    try {
      await placeCursor(sourceUri(), await lineOf(sourceUri(), 'nobody calls me'));
      const pinned = await vscode.commands.executeCommand<LineTestsResult>('whatTheTest.refresh');
      assert.strictEqual(pinned.line, line);
      assert.strictEqual(pinned.tests.length, 2);
    } finally {
      await vscode.commands.executeCommand('whatTheTest.unpin');
    }
    const unpinned = await vscode.commands.executeCommand<LineTestsResult>('whatTheTest.refresh');
    assert.strictEqual(unpinned.line, await lineOf(sourceUri(), 'nobody calls me'));
    assert.strictEqual(unpinned.tests.length, 0);
  });

  suite('tests covering changes', () => {
    let fake: Awaited<ReturnType<typeof createFakeController>>;
    setup(async () => {
      fake = await createFakeController('fake-changes', path => ['changes', ...path].join('.'));
    });
    teardown(async () => {
      fake.controller.dispose();
      await vscode.workspace.getConfiguration('whatTheTest').update('runTestsOnSave', undefined, vscode.ConfigurationTarget.Global);
      // Undo edits (saved or not) to the fixtures.
      for (const uri of [sourceUri(), testUri()]) {
        const doc = await vscode.workspace.openTextDocument(uri);
        const original = originals.get(uri.toString());
        if (original !== undefined && doc.getText() !== original) {
          const editor = await vscode.window.showTextDocument(doc);
          await editor.edit(b => b.replace(new vscode.Range(0, 0, doc.lineCount, 0), original));
        }
        if (doc.isDirty) {
          await doc.save();
        }
      }
    });

    const originals = new Map<string, string>();
    async function editLine(uri: vscode.Uri, needle: string, from: string, to: string): Promise<vscode.TextDocument> {
      const doc = await vscode.workspace.openTextDocument(uri);
      if (!originals.has(uri.toString())) {
        originals.set(uri.toString(), doc.getText());
      }
      const editor = await vscode.window.showTextDocument(doc);
      const line = editor.document.lineAt(await lineOf(uri, needle));
      await editor.edit(b => b.replace(line.range, line.text.replace(from, to)));
      return editor.document;
    }

    test('runs the tests covering unsaved changes', async () => {
      await editLine(sourceUri(), 'return a + b', 'a + b', 'b + a');
      const done = fake.waitForRuns(1);
      await vscode.commands.executeCommand('whatTheTest.runTestsForChanges');
      await done;
      assert.deepStrictEqual([...fake.ran].sort(), ['adds two numbers', 'sums a list']);
    });

    test('includes a test whose own code changed', async () => {
      await editLine(sourceUri(), 'nobody calls me', 'nobody', 'no one');
      await editLine(testUri(), 'sum([1, 2, 3])', '1, 2, 3', '3, 2, 1');
      const done = fake.waitForRuns(1);
      await vscode.commands.executeCommand('whatTheTest.runTestsForChanges');
      await done;
      assert.deepStrictEqual(fake.ran, ['sums a list']);
    });

    test('runs the tests covering a save when runTestsOnSave is on', async () => {
      await vscode.workspace.getConfiguration('whatTheTest').update('runTestsOnSave', true, vscode.ConfigurationTarget.Global);
      const doc = await editLine(sourceUri(), 'return a + b', 'a + b', 'b + a');
      const done = fake.waitForRuns(1);
      await doc.save();
      await done;
      assert.deepStrictEqual([...fake.ran].sort(), ['adds two numbers', 'sums a list']);
    });

    test('compares saved files with the last commit', async function () {
      const git = vscode.extensions.getExtension<any>('vscode.git'); // eslint-disable-line @typescript-eslint/no-explicit-any
      const api = git && (await git.activate()).getAPI(1);
      // The fixture is a subfolder of this repository, which VS Code doesn't open by default.
      const repo = api && await api.openRepository(vscode.Uri.joinPath(workspace(), '../..'));
      if (!repo) {
        this.skip();
      }
      const doc = await editLine(sourceUri(), 'return a + b', 'a + b', 'b + a');
      await doc.save();
      await waitFor('Git to see the change', async () =>
        repo.state.workingTreeChanges.some((c: { uri: vscode.Uri }) => c.uri.toString() === sourceUri().toString()) || undefined);
      const done = fake.waitForRuns(1);
      await vscode.commands.executeCommand('whatTheTest.runTestsForChanges');
      await done;
      assert.deepStrictEqual([...fake.ran].sort(), ['adds two numbers', 'sums a list']);
    });
  });
});
