#!/usr/bin/env node
// Re-records the README's images in docs/images: demo.gif and quick-pick.png.
//
//   npm run screenshots
//
// Packages the extension, installs it and the Jest extension into a throwaway
// VS Code profile in .vscode-test/screenshots, opens the small project in
// scripts/screenshots/shop and drives VS Code with Playwright.
//
// Needs ffmpeg to encode the GIF, on the PATH or set with FFMPEG=/path/to/ffmpeg.
// On Linux without a display it runs itself under xvfb-run. VSCODE_TEST_VERSION
// picks the VS Code version (default: stable), as for the integration tests.
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadAndUnzipVSCode, resolveCliPathFromVSCodeExecutablePath } from '@vscode/test-electron';
import { launch, sleep } from './driver.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const work = path.join(root, '.vscode-test/screenshots');
const userData = path.join(work, 'user-data');
const images = path.join(root, 'docs/images');
const ffmpeg = process.env.FFMPEG ?? 'ffmpeg';

/** Window size in CSS pixels. The quick pick needs a taller window to list every test. */
const WIDTH = 1280;
const DEMO_HEIGHT = 720;
const QUICK_PICK_HEIGHT = 1080;
/** Where the Tests Covering Line view is looked up and its message shown. */
const SIDE_BAR = '.part.sidebar';

const SETTINGS = {
  // No title bar: it says "[Superuser]" when recording as root, e.g. in a container.
  'window.titleBarStyle': 'native',
  'window.customTitleBarVisibility': 'never',
  'workbench.startupEditor': 'none',
  'workbench.tips.enabled': false,
  'workbench.enableExperiments': false,
  'workbench.welcomePage.walkthroughs.openOnInstall': false,
  'workbench.secondarySideBar.defaultVisibility': 'hidden',
  'workbench.editor.enablePreview': false,
  'chat.disableAIFeatures': true,
  'telemetry.telemetryLevel': 'off',
  'update.mode': 'none',
  'extensions.autoUpdate': false,
  'extensions.autoCheckUpdates': false,
  'extensions.ignoreRecommendations': true,
  'security.workspace.trust.enabled': false,
  'git.enabled': false,
  'breadcrumbs.enabled': false,
  'editor.fontSize': 14,
  'editor.lineHeight': 21,
  'editor.minimap.enabled': false,
  'editor.stickyScroll.enabled': false,
  'editor.scrollBeyondLastLine': false,
  'editor.codeLens': false,
  'editor.lightbulb.enabled': 'off',
  'editor.hover.enabled': 'off',
  // A blinking cursor would change every frame of the GIF.
  'editor.cursorBlinking': 'solid',
  'testing.automaticallyOpenTestResults': 'neverOpen',
  'testing.openTesting': 'neverOpen',
  // Jest: only run tests when asked, and don't open its terminal.
  'jest.runMode': 'on-demand',
  'jest.outputConfig': { revealOn: 'error', revealWithFocus: 'none', clearOnRun: 'none' },
};

async function main() {
  if (process.platform === 'linux' && !process.env.DISPLAY) {
    // The screen must fit the quick pick's window at twice its size.
    const result = spawnSync('xvfb-run', ['-a', '-s', '-screen 0 2600x2200x24', process.execPath, fileURLToPath(import.meta.url)], { stdio: 'inherit' });
    if (result.error) {
      throw new Error(`No display, and xvfb-run failed (${result.error.message}). Install xvfb or set DISPLAY.`);
    }
    process.exit(result.status ?? 1);
  }
  if (spawnSync(ffmpeg, ['-version']).error) {
    throw new Error(`Can't run ${ffmpeg}. Install ffmpeg, or set FFMPEG to its path.`);
  }

  const vscode = await setUp();
  await recordDemo(vscode);
  await recordQuickPick(vscode);
  rmSync(path.join(work, 'frames'), { recursive: true, force: true });
  for (const file of ['demo.gif', 'quick-pick.png']) {
    console.log(`Wrote docs/images/${file} (${Math.round(statSync(path.join(images, file)).size / 1024)} KB)`);
  }
}

/** Packages and installs the extensions into a fresh profile, and sets up the demo project. */
async function setUp() {
  rmSync(userData, { recursive: true, force: true });
  mkdirSync(path.join(userData, 'User'), { recursive: true });
  writeFileSync(path.join(userData, 'User/settings.json'), JSON.stringify(SETTINGS, null, 2));
  const profile = [`--extensions-dir=${path.join(work, 'extensions')}`, `--user-data-dir=${userData}`];

  const vsix = path.join(work, 'what-the-test.vsix');
  run('npx', ['vsce', 'package', '--out', vsix], root);
  const executablePath = await downloadAndUnzipVSCode(process.env.VSCODE_TEST_VERSION ?? 'stable');
  const cli = resolveCliPathFromVSCodeExecutablePath(executablePath);
  run(cli, [...profile, '--install-extension', vsix, '--force'], root);
  run(cli, [...profile, '--install-extension', 'orta.vscode-jest'], root);

  // The folder name shows in the Test Explorer, so keep it.
  const project = path.join(work, 'shop');
  rmSync(project, { recursive: true, force: true });
  cpSync(path.join(here, 'shop'), project, { recursive: true, filter: src => path.basename(src) !== 'node_modules' });
  run('npm', ['ci', '--no-audit', '--no-fund'], project);

  return { executablePath, args: [...profile, project] };
}

function run(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
}

/**
 * Opens the demo project with the Testing side bar showing the Test Explorer
 * above the Tests Covering Line view, and the cursor on an empty line of
 * src/cart.ts. Both TypeScript and Jest are ready by then.
 */
async function openWorkbench({ executablePath, args }, { height, scale }) {
  // Forget test results, open editors and the layout from the last recording.
  rmSync(path.join(userData, 'User/workspaceStorage'), { recursive: true, force: true });
  const wb = await launch({ executablePath, args, width: WIDTH, height, scale });
  try {
    await sleep(2000);
    // Running as root shows a warning.
    await wb.command('Notifications: Clear All Notifications');
    await wb.command('Focus on Tests Covering Line View');
    await wb.arrangeSideBar({ width: 430, secondView: 'Tests Covering Line', secondViewTop: 260 });

    // Jest lists the tests in a file once the file has been opened.
    for (const file of ['test/cart.test.ts', 'test/checkout.test.ts']) {
      await wb.openFile(file);
      await wb.page.waitForSelector('.editor-instance .codicon-testing-run-icon', { timeout: 60_000 });
    }
    await wb.command('View: Close All Editors');
    await expandInTestExplorer(wb, 'shop');
    await expandInTestExplorer(wb, 'test');

    await wb.openFile('src/cart.ts', 23);
    await waitForTypeScript(wb, 23);
    await wb.goToLine(6);
    await wb.waitForText(SIDE_BAR, /cover line 6\b/);
    return wb;
  } catch (err) {
    await wb.close();
    throw err;
  }
}

async function expandInTestExplorer(wb, label) {
  const row = await wb.box('.test-explorer .monaco-list-row', label);
  const expanded = await wb.page.evaluate(label => [...document.querySelectorAll('.test-explorer .monaco-list-row')]
    .find(e => e.textContent.includes(label)).getAttribute('aria-expanded'), label);
  if (expanded === 'false') {
    await wb.page.mouse.click(row.left + 14, row.y);
    await sleep(600);
  }
}

/** Waits until the extension finds tests for the line, refreshing while TypeScript starts. */
async function waitForTypeScript(wb, line) {
  const deadline = Date.now() + 120_000;
  for (;;) {
    try {
      await wb.waitForText(SIDE_BAR, new RegExp(`\\d+ tests? covers? line ${line}\\b`), 5_000);
      return;
    } catch (err) {
      if (Date.now() > deadline) {
        throw err;
      }
      await wb.command('What the Test: Refresh Tests Covering Line');
    }
  }
}

/** docs/images/demo.gif: the count follows the cursor, then Run All runs the tests. */
async function recordDemo(vscode) {
  console.log('Recording demo.gif…');
  const wb = await openWorkbench(vscode, { height: DEMO_HEIGHT, scale: 1 });
  let frames;
  try {
    await wb.showPointer(1000, 140);
    await sleep(1000);
    const stop = await wb.record(path.join(work, 'frames'));
    await sleep(800);
    for (const line of [8, 12, 23]) {
      await wb.clickLineEnd(line);
      await wb.waitForText(SIDE_BAR, new RegExp(`covers? line ${line}\\b`));
      await sleep(1600);
    }

    const header = await wb.box(`${SIDE_BAR} .pane-header`, 'Tests Covering Line');
    await wb.moveTo(header.x - 60, header.y, 700);
    const runAll = await wb.box(`${SIDE_BAR} .pane-header`, 'Tests Covering Line', '.codicon-run-all');
    await wb.click(runAll.x, runAll.y, 350);
    await waitForTestRun(wb);
    await sleep(300);
    await wb.moveTo(1100, 620, 600);
    await sleep(2800);
    frames = await stop();
  } finally {
    await wb.close();
  }
  // A constant 25 fps, because browsers slow down GIF frames shorter than 20 ms.
  execFileSync(ffmpeg, [
    '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', frames,
    '-vf', 'fps=25,split[a][b];[a]palettegen=max_colors=128:stats_mode=full[p];[b][p]paletteuse=dither=none',
    '-loop', '0', path.join(images, 'demo.gif'),
  ], { stdio: 'inherit' });
}

async function waitForTestRun(wb) {
  const busy = '.test-explorer .codicon-loading, .test-explorer .codicon-testing-queued-icon';
  await wb.page.waitForSelector(busy, { timeout: 15_000 });
  await wb.page.waitForFunction(busy => !document.querySelector(busy), busy, { timeout: 60_000 });
  if (await wb.page.$('.test-explorer .codicon-testing-failed-icon, .test-explorer .codicon-testing-error-icon')) {
    throw new Error('Some tests failed; see the Test Explorer');
  }
}

/**
 * docs/images/quick-pick.png, at twice the size so it stays sharp when the
 * README shows it at half its width.
 */
async function recordQuickPick(vscode) {
  console.log('Recording quick-pick.png…');
  const wb = await openWorkbench(vscode, { height: QUICK_PICK_HEIGHT, scale: 2 });
  try {
    await wb.goToLine(23);
    await wb.waitForText(SIDE_BAR, /cover line 23\b/);
    await wb.command('What the Test: Show Tests Covering Line');
    await wb.page.waitForSelector('.quick-input-widget .monaco-list-row', { state: 'visible' });
    // Past "Run all" and "Debug all" to the second test, which the editor previews.
    for (let i = 0; i < 3; i++) {
      await wb.page.keyboard.press('ArrowDown');
      await sleep(500);
    }
    await sleep(1000);
    const box = await wb.box('.quick-input-widget');
    await wb.page.screenshot({
      path: path.join(images, 'quick-pick.png'),
      clip: { x: box.left, y: box.top, width: box.right - box.left, height: box.bottom - box.top },
    });
  } finally {
    await wb.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
