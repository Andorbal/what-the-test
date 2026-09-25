#!/usr/bin/env node
// Builds the installable .vsix. Versions with an odd minor number (0.3.x, 1.5.x)
// are packaged as VS Code pre-releases; see RELEASING.md.
//
//   node scripts/package.mjs            -> what-the-test-<version>.vsix
//   node scripts/package.mjs --print    -> prints JSON describing the package without building it
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const minor = Number(pkg.version.split('.')[1]);
const preRelease = minor % 2 === 1;
const file = `${pkg.name}-${pkg.version}.vsix`;

if (process.argv.includes('--print')) {
  console.log(JSON.stringify({ version: pkg.version, preRelease, file }));
} else {
  const args = ['vsce', 'package', '--out', file, ...(preRelease ? ['--pre-release'] : [])];
  execFileSync('npx', args, { stdio: 'inherit', shell: process.platform === 'win32' });
  console.log(`Packaged ${file}${preRelease ? ' (pre-release)' : ''}`);
}
