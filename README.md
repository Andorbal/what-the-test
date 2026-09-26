# What the Test

A VS Code extension that answers **"which tests exercise this line?"** It shows
how many tests reach the line under your cursor, lets you jump to any of them,
and runs one or all of them through VS Code's built-in **Testing**
infrastructure. It doesn't add a test runner of its own.

Supported out of the box:

| Language | Test frameworks recognised | Runs through |
| --- | --- | --- |
| C# / .NET | xUnit, NUnit, MSTest, TUnit, FsCheck | C# Dev Kit or any other .NET test controller |
| TypeScript / JavaScript (incl. JSX/TSX) | Jest, Vitest, Mocha (BDD & TDD), Jasmine, `node:test`, Playwright, Bun | Jest, Vitest, Mocha Test Explorer, Playwright, ... |

Other languages can be added by implementing a small adapter (see
[Adding a language](#adding-a-language)).

## Installation

Download `what-the-test-<version>.vsix` from the
[latest GitHub Release](https://github.com/andorbal/what-the-test/releases), or
from the `vsix` artifact of any [CI run](https://github.com/andorbal/what-the-test/actions/workflows/ci.yml). Then either:

- in VS Code, open the Extensions view → `…` → **Install from VSIX…**, or
- run `code --install-extension what-the-test-<version>.vsix`.

Versions with an odd minor number (such as 0.1.x) are pre-releases. See
[RELEASING.md](RELEASING.md) for the versioning strategy and release process,
and [CHANGELOG.md](CHANGELOG.md) for what changed.

## Features

- **Inline count**: `⚗ 3 tests` appears at the end of the current line when tests reach it.
- **Status bar**: a beaker icon and the test count for the current line. Click it to open the test list.
- **Tests Covering Line view** in the Testing side bar: lists the tests for the
  current line, each with **Run**, **Debug** and **Go to Test** buttons, and
  **Run All**, **Debug All** and **Refresh** in the view title.
- **Quick pick** (`What the Test: Show Tests Covering Line`, also in the editor
  context menu): previews each test as you move through the list. Pick a test
  to open it, use the item buttons to run or debug it, or choose *Run all* / *Debug all*.
- **Commands**: `Run All Tests Covering Line` and `Debug All Tests Covering Line`
  (editor context menu and Command Palette).

Each test entry says how it reaches the line, for example *calls it directly*
or *via Calculator.Sum → Parse*.

## How it works

### Finding tests: a static call graph

Given a line, the extension finds the symbol that contains it (a method,
function, property, ...) using the language's document symbols. It then walks
**up** the call graph with the language server's *Call Hierarchy* ("Show
Incoming Calls"). Where there's no call hierarchy (for example properties and
fields), it uses *Find All References* instead. When a call site falls inside a
test, the test is recorded and the walk stops on that branch. Otherwise the
walk continues through the caller.

- The line is inside a test or a setup region: no tests are listed, because
  the line is test code rather than code under test.
- The call site is in a setup region (`beforeEach`, `[SetUp]`,
  `[TestInitialize]`, an xUnit constructor, ...): the enclosing suite covers it.
- Helper functions in test files are walked through like any other caller, so
  a line in a helper lists the tests that use it.
- The walk is bounded by `whatTheTest.maxSearchDepth` and
  `whatTheTest.maxVisitedSymbols`. A `+` after the count means a limit was hit.

The language servers do the semantic work, so no build or test run is needed:
the TypeScript server built into VS Code, and Roslyn from the C# extension. Each
language adapter only needs to recognise which parts of a test file are tests.

> This is *reachability*, not runtime coverage. Calls through interfaces,
> dependency injection, reflection or dynamic dispatch may not show up, and a
> call on a branch the test never takes still counts.

### Running tests: VS Code's Testing API

The extension doesn't run test frameworks itself. For each covering test, it:

1. Asks VS Code which test items exist in the test's file
   (`vscode.testing.getTestsInFile`), whichever extension provides them.
2. Matches the parsed test (name and describe/class path) to one of those item IDs.
3. Runs all matched tests in **a single run** with `vscode.runTestsById`, using
   the Run or Debug profile.
4. Some controllers use opaque IDs (hashes). If none of a test's IDs match, the
   extension puts the cursor on the test and calls VS Code's own **Run Test at
   Cursor** / **Debug Test at Cursor**, then returns you to where you were.

Results appear in the Test Explorer, the Test Results panel and the gutter as
usual. You still need a testing extension installed for your framework (for
example C# Dev Kit, Jest, Vitest or Mocha Test Explorer).

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `whatTheTest.showInlineCount` | `true` | Show the count at the end of the current line. |
| `whatTheTest.showStatusBar` | `true` | Show the count in the status bar. |
| `whatTheTest.maxSearchDepth` | `8` | Levels of callers to walk. |
| `whatTheTest.maxVisitedSymbols` | `400` | Maximum symbols visited per line. |
| `whatTheTest.debounceMs` | `400` | Delay after the cursor stops before searching. |
| `whatTheTest.csharp.additionalTestAttributes` | `[]` | Extra attributes that mark a C# test method. |
| `whatTheTest.javascript.additionalTestFunctions` | `[]` | Extra JS/TS functions that declare a test. |
| `whatTheTest.javascript.additionalSuiteFunctions` | `[]` | Extra JS/TS functions that declare a suite. |

## Adding a language

Everything except test recognition is language-agnostic: the call-graph walk,
test ID matching, running, and the UI. To support a new language, implement
`LanguageAdapter` ([src/core/languageAdapter.ts](src/core/languageAdapter.ts)):

```ts
export interface LanguageAdapter {
  readonly id: string;                      // e.g. 'python'
  readonly displayName: string;             // e.g. 'Python'
  readonly languageIds: readonly string[];  // VS Code language IDs, e.g. ['python']
  isTestFile(document: vscode.TextDocument): boolean;       // cheap pre-check
  parseTests(document: vscode.TextDocument): ParsedTestFile; // tests, suites, setup regions
  matchTestId?(declaration, candidates): readonly string[] | undefined; // optional
}
```

`parseTests` returns each test and suite with its name, container path and
range, plus any setup regions. See the built-in adapters for examples:

- C#: [csharpAdapter.ts](src/languages/csharp/csharpAdapter.ts) and [csharpTestParser.ts](src/languages/csharp/csharpTestParser.ts)
- JS/TS: [javascriptAdapter.ts](src/languages/javascript/javascriptAdapter.ts) and [jsTestParser.ts](src/languages/javascript/jsTestParser.ts)

The parsers are plain TypeScript with no `vscode` import, so you can unit test
them with Mocha.

To register an adapter, either:

- **Built in:** add it to [src/languages/index.ts](src/languages/index.ts) and
  add `onLanguage:<id>` to `activationEvents` in `package.json`.
- **From another extension**, through the exported API:

  ```ts
  const api = await vscode.extensions.getExtension('andorbal.what-the-test')!.activate();
  context.subscriptions.push(api.registerLanguageAdapter(new MyLanguageAdapter()));
  ```

The language also needs a language server that provides document symbols and
call hierarchy or references, which most do.

## Project layout

```
src/
  extension.ts                 activation, commands, exported API
  core/
    types.ts                   editor-independent types (TestDeclaration, ranges, lookups)
    languageAdapter.ts         the LanguageAdapter interface
    adapterRegistry.ts         registered adapters + parsed test file cache
    coveringTestFinder.ts      call-graph walk that finds the tests reaching a line
    idMatching.ts              matches parsed tests to VS Code test item IDs
    testingBridge.ts           runs/debugs/reveals tests through VS Code's Testing API
  languages/
    text.ts                    shared scanning helpers
    csharp/                    C# masking, parser and adapter
    javascript/                JS/TS masking, parser and adapter
  ui/                          status bar, inline hint, tree view, quick pick
  test/
    unit/                      Mocha tests for parsers and ID matching (no VS Code needed)
    integration/               tests that run inside VS Code against the fixtures
test-fixtures/
  ts-project/                  small TS project used by the integration tests
  csharp-project/              small xUnit solution used by the C# integration tests
```

## Development

```sh
npm install
npm run compile
npm run test:unit                 # parsers and ID matching, plain Node
npm run test:integration          # in VS Code: TS language server + fake test controllers
npm run test:integration:csharp   # in VS Code with the C# extension (needs the .NET SDK)
npm run package                   # builds what-the-test-<version>.vsix
```

On Linux without a display, prefix the integration tests with `xvfb-run -a`.
Press <kbd>F5</kbd> in VS Code to start an Extension Development Host. The
launch configurations open the TS or C# fixture project.

The TypeScript integration tests register fake test controllers, one with
name-based IDs and one with opaque IDs. They check that the right tests reach
VS Code's Testing API through both `vscode.runTestsById` and the Run Test at
Cursor fallback.
