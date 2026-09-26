# Changelog

All notable changes to What the Test are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html); see
[RELEASING.md](RELEASING.md) for how versions are chosen and released.

## [Unreleased]

### Added

- Versioning strategy and release process ([RELEASING.md](RELEASING.md)).
- Release workflow: pushing a `v*` tag tests the extension, packages a `.vsix`
  and publishes it as a GitHub Release.
- CI uploads an installable `.vsix` for every push and pull request.

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

[Unreleased]: https://github.com/andorbal/what-the-test/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/andorbal/what-the-test/releases/tag/v0.1.0
