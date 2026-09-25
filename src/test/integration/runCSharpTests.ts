import * as cp from 'child_process';
import * as path from 'path';
import { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath, runTests } from '@vscode/test-electron';

/**
 * End-to-end tests against the real C# extension (Roslyn). Requires the .NET
 * SDK on PATH; the C# extensions are installed from the Marketplace.
 */
async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '../../../');
  const workspace = path.resolve(extensionDevelopmentPath, 'test-fixtures/csharp-project');
  const extensionsDir = path.resolve(extensionDevelopmentPath, '.vscode-test/extensions-csharp');
  const vscodeExecutablePath = await downloadAndUnzipVSCode(process.env.VSCODE_TEST_VERSION ?? 'stable');
  const [cli, ...args] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath);

  cp.execFileSync('dotnet', ['build', workspace], { stdio: 'inherit' });
  const extensions = (process.env.WTT_CSHARP_EXTENSIONS ?? 'ms-dotnettools.csharp').split(',');
  for (const ext of extensions) {
    cp.spawnSync(cli, [...args, '--extensions-dir', extensionsDir, '--install-extension', ext], { stdio: 'inherit', shell: process.platform === 'win32' });
  }

  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath,
    extensionTestsPath: path.resolve(__dirname, './suite/index'),
    extensionTestsEnv: { WTT_SUITE: 'csharp' },
    launchArgs: [workspace, '--extensions-dir', extensionsDir, '--disable-workspace-trust', '--skip-welcome'],
  });
}

main().catch(err => {
  console.error('Failed to run tests', err);
  process.exit(1);
});
