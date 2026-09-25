#!/usr/bin/env node
// Helpers for CHANGELOG.md (Keep a Changelog format).
//
//   node scripts/changelog.mjs release <version>   Moves "Unreleased" entries under a new
//                                                  version heading (run by `npm version`).
//   node scripts/changelog.mjs notes <version>     Prints the entries for a version; fails
//                                                  if there are none (used by the release workflow).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO = 'https://github.com/andorbal/what-the-test';
const path = fileURLToPath(new URL('../CHANGELOG.md', import.meta.url));
const [command, rawVersion] = process.argv.slice(2);
const version = rawVersion?.replace(/^v/, '');

function fail(message) {
  console.error(`changelog: ${message}`);
  process.exit(1);
}

/** Returns [start, end) of the body of the section with the given heading text. */
function section(text, heading) {
  const re = new RegExp(`^## \\[${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\].*$`, 'm');
  const match = re.exec(text);
  if (!match) {
    return undefined;
  }
  const start = match.index + match[0].length;
  const next = text.slice(start).search(/^## \[|^\[[^\]]+\]: /m);
  return { headingStart: match.index, start, end: next === -1 ? text.length : start + next };
}

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  fail(`expected a version like 1.2.3, got '${rawVersion ?? ''}'`);
}
const text = readFileSync(path, 'utf8');

if (command === 'notes') {
  const s = section(text, version);
  const body = s && text.slice(s.start, s.end).trim();
  if (!body) {
    fail(`CHANGELOG.md has no entries for ${version}. Add a "## [${version}]" section.`);
  }
  process.stdout.write(`${body}\n`);
} else if (command === 'release') {
  if (section(text, version)) {
    fail(`CHANGELOG.md already has a section for ${version}.`);
  }
  const unreleased = section(text, 'Unreleased');
  const body = unreleased && text.slice(unreleased.start, unreleased.end).trim();
  if (!body) {
    fail('the "Unreleased" section is empty; describe the changes before releasing.');
  }
  const date = new Date().toISOString().slice(0, 10);
  let updated =
    text.slice(0, unreleased.start) +
    `\n\n## [${version}] - ${date}\n\n${body}\n\n` +
    text.slice(unreleased.end);

  // Update the comparison links at the bottom of the file.
  const previous = /^\[Unreleased\]: .*compare\/(v[^.]+\.[^.]+\.[^.]+)\.\.\.HEAD$/m.exec(updated)?.[1];
  updated = updated.replace(/^\[Unreleased\]: .*$/m,
    `[Unreleased]: ${REPO}/compare/v${version}...HEAD\n` +
    `[${version}]: ${previous ? `${REPO}/compare/${previous}...v${version}` : `${REPO}/releases/tag/v${version}`}`);
  writeFileSync(path, updated.replace(/\n{3,}/g, '\n\n'));
  console.log(`changelog: moved Unreleased entries to ${version}`);
} else {
  fail(`unknown command '${command ?? ''}' (expected 'release' or 'notes')`);
}
