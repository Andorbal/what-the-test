# Changelog

All notable changes to What the Test are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html); see
[RELEASING.md](RELEASING.md) for how versions are chosen and released.

## [Unreleased]

## [0.4.0] - 2026-09-27

### Added

- F# support: xUnit, NUnit, MSTest and FsCheck tests (attributed `let`
  bindings and members, including ``` ``double backtick`` ``` names) and
  Expecto `testList` / `testCase` / `test` declarations. Uses Ionide's
  language server; tests run through Ionide's or any other .NET test controller.
  New setting `whatTheTest.fsharp.additionalTestAttributes`.
- Go support: `TestXxx`, `BenchmarkXxx`, `FuzzXxx` and `ExampleXxx`
  functions, `t.Run` subtests with literal names, and testify suite methods
  (with `SetupTest` and friends as setup). Uses gopls; tests run through the
  Go extension. A subtest that hasn't run yet (so has no test item) runs
  through its parent test.
- Java support: JUnit 5 (including `@Nested` classes), JUnit 4, TestNG and
  jqwik tests, with `@BeforeEach` and friends and test class constructors as
  setup. Uses the Java extension's language server; tests run through the
  Test Runner for Java. New setting `whatTheTest.java.additionalTestAnnotations`.
- Python support: pytest `test*` functions and `Test*` classes, unittest
  `TestCase` classes, their setup methods, autouse fixtures and module-level
  setup. Regular pytest fixtures are followed to the tests that request them.
  Uses Pylance; tests run through the Python extension.
- The Tests Covering Line view keeps its list when you go into one of the
  listed tests, and selects that test, so you can go through them one by one.
  "Run All" and "Debug All" still run the whole list.
- **Pin** button in the Tests Covering Line view (and `Pin Tests Covering Line`
  / `Unpin Tests Covering Line` commands) to stop the list from following the cursor.
- `Run Tests Covering Changes`, `Debug Tests Covering Changes` and
  `Show Tests Covering Changes`: find the tests that reach code changed since
  the last commit (including unsaved edits) and run them together. Also in the
  Source Control view's `…` menu.
- `whatTheTest.runTestsOnSave` setting (off by default): after each save, run
  the tests covering the lines that changed.
- Keyboard shortcuts, next to VS Code's own test shortcuts: `Ctrl+; W` runs
  the tests covering the line (`Ctrl+; Ctrl+W` debugs them, `Ctrl+; Shift+W`
  lists them), and `Ctrl+; G` / `Ctrl+; Ctrl+G` / `Ctrl+; Shift+G` do the same
  for the tests covering your changes. `Cmd` instead of `Ctrl` on macOS.
- An extension icon.

### Changed

- Calls through interfaces and base classes are followed: the callers of the
  interface and base-class members a method implements or overrides count as
  its callers (using the language server's type hierarchy). In C#, these tests
  used to be found only when nothing called the method directly.

### Fixed

- The view's **Refresh** button now discards cached results, so it picks up
  tests the language server hadn't indexed yet.

## [0.2.2] - 2026-09-26

### Changed

- Fixed publisher in integration tests

## [0.2.1] - 2026-09-26

### Changed

- Fixed the publisher to match the actual value

## [0.2.0] - 2026-09-26

### Added

- Versioning strategy and release process ([RELEASING.md](RELEASING.md)).
- Release workflow: pushing a `v*` tag tests the extension, packages a `.vsix`
  and publishes it as a GitHub Release.
- CI uploads an installable `.vsix` for every push and pull request.

### Changed

- A line inside a test (or a setup region such as `beforeEach`) no longer lists
  that test as covering it. The status bar count is hidden there, and the Tests
  Covering Line view names the test the line belongs to. The exported
  `findTestsForLine` reports that test as `enclosingTest`.

### Fixed

- TypeScript/JavaScript: when several tests in one file call the code, all of
  them are found, not only the first.
- Messages about a single test say "1 test covers line …" instead of "1 test cover line …".

## [0.1.0] - 2026-09-25

### Added

- Shows how many tests reach the current line (end-of-line hint and status bar).
- "Tests Covering Line" view in the Testing side bar and a quick pick to open,
  run or debug any covering test, or run/debug all of them.
- Runs tests through VS Code's Testing API (`vscode.runTestsById`), falling back
  to "Run Test at Cursor" for test controllers with opaque IDs.
- C#/.NET support (xUnit, NUnit, MSTest, TUnit) and TypeScript/JavaScript support
  (Jest, Vitest, Mocha, Jasmine, `node:test`, Playwright).
- Pluggable language adapters, including registration from other extensions.

[Unreleased]: https://github.com/andorbal/what-the-test/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/andorbal/what-the-test/compare/v0.2.2...v0.4.0
[0.2.2]: https://github.com/andorbal/what-the-test/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/andorbal/what-the-test/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/andorbal/what-the-test/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/andorbal/what-the-test/releases/tag/v0.1.0
