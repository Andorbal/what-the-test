# Versioning and releasing

## Version numbers

What the Test follows [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.
The "public API" that SemVer protects is everything a user or another
extension can depend on:

- command IDs (`whatTheTest.*`) and their arguments
- setting names and their meaning (`whatTheTest.*`)
- the exported extension API (`WhatTheTestApi`, `LanguageAdapter` and the types they use)

| Change | Bump | Examples |
| --- | --- | --- |
| Breaks something above | **major** | rename/remove a command or setting, change the `LanguageAdapter` interface incompatibly |
| Adds functionality, backwards compatible | **minor** | new language, new command or setting, new optional adapter method, raising the minimum VS Code version |
| Fixes behaviour, no new surface | **patch** | parser fixes, better ID matching, UI polish |

While the version is `0.x`, breaking changes bump the **minor** version instead
of the major version, as SemVer allows.

### Pre-releases: odd minor versions

The VS Code Marketplace only accepts `MAJOR.MINOR.PATCH` versions (no `-beta.1`
suffixes), so pre-releases follow VS Code's own convention:

- **odd minor** (`0.1.x`, `0.3.x`, `1.5.x`) → pre-release
- **even minor** (`0.2.x`, `1.0.x`, `1.4.x`) → stable release

`npm run package` and the release workflow read the version and pass
`--pre-release` to `vsce` automatically. GitHub Releases for odd minors are
marked "Pre-release". The first version, `0.1.0`, is a pre-release.

## Changelog

Every user-visible change adds a line to the `## [Unreleased]` section of
[CHANGELOG.md](CHANGELOG.md) in the same pull request. Put it under `Added`,
`Changed`, `Deprecated`, `Removed`, `Fixed` or `Security`
([Keep a Changelog](https://keepachangelog.com/en/1.1.0/)).
You don't write version headings by hand; the release step creates them.

## Cutting a release

From an up-to-date `main` with a clean working tree:

```sh
npm version minor     # or: major | patch | 0.3.0
git push --follow-tags
```

`npm version` does the following:

1. Bumps `version` in `package.json` and `package-lock.json`.
2. Runs `scripts/changelog.mjs release`, which moves the `Unreleased` entries
   under a new `## [x.y.z] - YYYY-MM-DD` heading and updates the compare links.
   It fails if `Unreleased` is empty. If that happens, restore `package.json`
   and `package-lock.json` with `git checkout`, add entries, and try again.
3. Commits the change as `x.y.z` and creates the tag `vx.y.z`.

Pushing the tag starts [the release workflow](.github/workflows/release.yml),
which:

1. Checks that the tag matches `package.json` and that CHANGELOG.md has
   entries for the version.
2. Runs the full CI workflow: unit tests, integration tests for every
   supported language (TypeScript, C#, F#, Go, Python and Java), and packaging.
3. Creates a GitHub Release named after the tag. It attaches the `.vsix` and
   uses the version's changelog section as the release notes.
4. Publishes that `.vsix` to the VS Code Marketplace and to Open VSX, as the
   `AndrewBenz` publisher (a pre-release for odd minors). Each is its own job:
   if one fails, re-run just that job once the problem is fixed; the GitHub
   Release is already in place.

## Marketplace publishing

### VS Code Marketplace

The `publish-vscode` job signs in with Microsoft Entra ID; there is no personal
access token. It needs:

- A GitHub environment named `vscode-marketplace` whose deployment policy
  allows `v*` tags, with the **variables** (not secrets) `AZURE_CLIENT_ID` and
  `AZURE_TENANT_ID`.
- An Entra app registration (that client ID) with a federated credential for
  GitHub Actions: organization `Andorbal`, repository `what-the-test`, entity
  type *Environment*, environment `vscode-marketplace`.
- That identity added as a member (role Contributor or higher) of the
  `AndrewBenz` publisher at
  <https://marketplace.visualstudio.com/manage/publishers/AndrewBenz>.

### Open VSX

[Open VSX](https://open-vsx.org) is the registry used by VSCodium, Cursor,
Windsurf, Gitpod and other VS Code builds that can't use Microsoft's
Marketplace. It only supports personal access tokens, so the `publish-openvsx`
job needs:

- An open-vsx.org account (sign in with GitHub) linked to an Eclipse account,
  with the Eclipse Foundation Open VSX Publisher Agreement signed, both from
  the account's settings page.
- An access token from **Settings → Access Tokens**, used once to create the
  namespace that matches `publisher` in `package.json`:
  `npx --yes ovsx@1.2.0 create-namespace AndrewBenz -p <token>`.
- A GitHub environment named `open-vsx` whose deployment policy allows `main`
  and `v*` tags, with that token as the **secret** `OVSX_PAT`.

Until the namespace's ownership is verified, Open VSX shows the extension as
unverified; to verify it, open a namespace-ownership issue at
<https://github.com/EclipseFdn/open-vsx.org/issues>.

### Checking the setup

To check both marketplaces without publishing anything, run the
[Marketplace check](.github/workflows/marketplace-check.yml) workflow from the
Actions tab.

## Installing a build

Every CI run (pushes to `main`, pull requests and manual runs) uploads a
`vsix` artifact. Releases attach the `.vsix` to the GitHub Release.

To install a `.vsix`:

- **VS Code:** Extensions view → `…` menu → **Install from VSIX…**
- **Command line:** `code --install-extension what-the-test-0.1.0.vsix`

To build one locally, run `npm ci && npm run package`.
