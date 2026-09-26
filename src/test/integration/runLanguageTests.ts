import * as cp from 'child_process';
import * as path from 'path';
import { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath, runTests } from '@vscode/test-electron';

interface LanguageSuite {
  /** Folder under test-fixtures to open. */
  fixture: string;
  /** Marketplace extensions that provide the language server (override with WTT_<LANGUAGE>_EXTENSIONS). */
  extensions: string[];
  /** Command that prepares the fixture, run in its folder. */
  build?: string[];
}

/**
 * End-to-end tests against real language servers, installed from the
 * Marketplace. Each needs its toolchain on PATH (the .NET SDK for C# and F#,
 * Go and gopls for Go).
 *
 *   node runLanguageTests.js <csharp|fsharp|go>
 */
const SUITES: Record<string, LanguageSuite> = {
  csharp: { fixture: 'csharp-project', extensions: ['ms-dotnettools.csharp'], build: ['dotnet', 'build'] },
  fsharp: { fixture: 'fsharp-project', extensions: ['ionide.ionide-fsharp'], build: ['dotnet', 'build'] },
  go: { fixture: 'go-project', extensions: ['golang.go'] },
};

async function main(): Promise<void> {
  const language = process.argv[2];
  const suite = SUITES[language];
  if (!suite) {
    throw new Error(`Usage: runLanguageTests <${Object.keys(SUITES).join('|')}>`);
  }
  const extensionDevelopmentPath = path.resolve(__dirname, '../../../');
  const workspace = path.resolve(extensionDevelopmentPath, 'test-fixtures', suite.fixture);
  const extensionsDir = path.resolve(extensionDevelopmentPath, `.vscode-test/extensions-${language}`);
  const vscodeExecutablePath = await downloadAndUnzipVSCode(process.env.VSCODE_TEST_VERSION ?? 'stable');
  const [cli, ...args] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath);

  if (suite.build) {
    cp.execFileSync(suite.build[0], suite.build.slice(1), { cwd: workspace, stdio: 'inherit' });
  }
  const extensions = process.env[`WTT_${language.toUpperCase()}_EXTENSIONS`]?.split(',') ?? suite.extensions;
  for (const ext of extensions) {
    cp.spawnSync(cli, [...args, '--extensions-dir', extensionsDir, '--install-extension', ext], { stdio: 'inherit', shell: process.platform === 'win32' });
  }

  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath,
    extensionTestsPath: path.resolve(__dirname, './suite/index'),
    extensionTestsEnv: { WTT_SUITE: language },
    launchArgs: [workspace, '--extensions-dir', extensionsDir, '--disable-workspace-trust', '--skip-welcome'],
  });
}

main().catch(err => {
  console.error('Failed to run tests', err);
  process.exit(1);
});
