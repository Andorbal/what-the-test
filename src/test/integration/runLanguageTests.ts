import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath, runTests } from '@vscode/test-electron';

interface LanguageSuite {
  /** Folder under test-fixtures to open. */
  fixture: string;
  /** Marketplace extensions that provide the language server (override with WTT_<LANGUAGE>_EXTENSIONS). */
  extensions: string[];
  /** Command that prepares the fixture, run in its folder. */
  build?: string[];
  /** User settings for the test instance of VS Code. */
  settings?: () => Record<string, unknown>;
}

/** The Python to run pytest with: $WTT_PYTHON, or python3 from PATH. It needs pytest installed. */
function python(): string {
  const executable = process.env.WTT_PYTHON ??
    cp.execFileSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).trim();
  cp.execFileSync(executable, ['-m', 'pytest', '--version'], { stdio: 'inherit' });
  return executable;
}

/**
 * End-to-end tests against real language servers, installed from the
 * Marketplace. Each needs its toolchain on PATH (the .NET SDK for C# and F#,
 * Go and gopls for Go, Python with pytest for Python; the Java extension
 * brings its own JDK and downloads the fixture's Maven dependencies).
 *
 *   node runLanguageTests.js <csharp|fsharp|go|java|python>
 */
const SUITES: Record<string, LanguageSuite> = {
  csharp: { fixture: 'csharp-project', extensions: ['ms-dotnettools.csharp'], build: ['dotnet', 'build'] },
  fsharp: { fixture: 'fsharp-project', extensions: ['ionide.ionide-fsharp'], build: ['dotnet', 'build'] },
  go: { fixture: 'go-project', extensions: ['golang.go'] },
  java: { fixture: 'java-project', extensions: ['redhat.java', 'vscjava.vscode-java-test'] },
  python: { fixture: 'python-project', extensions: ['ms-python.python'], settings: () => ({ 'python.defaultInterpreterPath': python() }) },
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

  // A fresh profile for each run, so settings and state from earlier runs don't leak in.
  const userDataDir = path.resolve(extensionDevelopmentPath, `.vscode-test/user-data-${language}`);
  fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(userDataDir, 'User'), { recursive: true });
  fs.writeFileSync(path.join(userDataDir, 'User', 'settings.json'), JSON.stringify(suite.settings?.() ?? {}, undefined, 2));

  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath,
    extensionTestsPath: path.resolve(__dirname, './suite/index'),
    extensionTestsEnv: { WTT_SUITE: language },
    launchArgs: [workspace, '--extensions-dir', extensionsDir, '--user-data-dir', userDataDir, '--disable-workspace-trust', '--skip-welcome'],
  });
}

main().catch(err => {
  console.error('Failed to run tests', err);
  process.exit(1);
});
