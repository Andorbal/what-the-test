// Drives the VS Code window for the recordings: runs commands, clicks with a
// visible mouse pointer and records the window. Used by record.mjs.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { _electron as electron } from 'playwright-core';

export { sleep };

/** The modifier for Quick Open (Ctrl+P / Cmd+P). */
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

/**
 * Starts VS Code with its content area at `width` x `height` pixels, times
 * `scale` on screen. `args` are extra command-line arguments.
 */
export async function launch({ executablePath, args, width, height, scale = 1 }) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    executablePath,
    env,
    args: [
      `--force-device-scale-factor=${scale}`, '--no-sandbox', '--disable-gpu-sandbox', '--disable-updates',
      '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', '--disable-telemetry',
      '--disable-crash-reporter', ...args,
    ],
  });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }, { width, height }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.unmaximize();
    win.setContentSize(width, height);
    win.setPosition(0, 0);
  }, { width, height });
  await page.waitForSelector('.monaco-workbench', { timeout: 60_000 });
  // Window chrome, such as a native menu bar, can take part of the content area.
  for (let i = 0; i < 3; i++) {
    const inner = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
    if (inner.width === width && inner.height === height) {
      break;
    }
    await app.evaluate(({ BrowserWindow }, grow) => {
      const win = BrowserWindow.getAllWindows()[0];
      const [w, h] = win.getContentSize();
      win.setContentSize(w + grow.width, h + grow.height);
    }, { width: width - inner.width, height: height - inner.height });
    await sleep(300);
  }
  return new Workbench(app, page);
}

export class Workbench {
  #pointer = { x: 0, y: 0 };

  constructor(app, page) {
    this.app = app;
    this.page = page;
  }

  close() {
    return this.app.close();
  }

  /** Runs a command through the Command Palette by its title. */
  async command(title) {
    await this.page.keyboard.press('F1');
    await this.#typeInQuickInput(title);
    await this.page.keyboard.press('Enter');
    await sleep(300);
  }

  /** Opens a file with Quick Open, optionally at a (1-based) line. */
  async openFile(name, line) {
    await this.page.keyboard.press(`${MOD}+P`);
    await this.#typeInQuickInput(name);
    await this.page.keyboard.press('Enter');
    await sleep(500);
    if (line) {
      await this.goToLine(line);
    }
  }

  /** Moves the cursor to a (1-based) line in the active editor. */
  async goToLine(line) {
    await this.page.keyboard.press('Control+G');
    await this.#typeInQuickInput(String(line));
    await this.page.keyboard.press('Enter');
    await sleep(200);
  }

  async #typeInQuickInput(text) {
    await this.page.waitForSelector('.quick-input-widget input', { state: 'visible' });
    await this.page.keyboard.type(text, { delay: 5 });
    await sleep(500);
  }

  /**
   * Bounding box of the first element matching `selector` whose text
   * contains `text`, or of the element matching `inner` inside it.
   */
  async box(selector, text, inner) {
    const box = await this.page.evaluate(([selector, text, inner]) => {
      let el = [...document.querySelectorAll(selector)].find(e => !text || e.textContent.includes(text));
      if (el && inner) {
        el = el.querySelector(inner);
      }
      const r = el?.getBoundingClientRect();
      return r && { left: r.left, top: r.top, right: r.right, bottom: r.bottom, x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, [selector, text, inner]);
    if (!box) {
      throw new Error(`Nothing matches ${selector}${text ? ` containing "${text}"` : ''}${inner ? ` > ${inner}` : ''}`);
    }
    return box;
  }

  /** Waits until the text of the element matching `selector` matches `pattern`. */
  async waitForText(selector, pattern, timeout = 60_000) {
    await this.page.waitForFunction(
      ([selector, source, flags]) => new RegExp(source, flags).test(document.querySelector(selector)?.textContent ?? ''),
      [selector, pattern.source, pattern.flags],
      { timeout },
    );
  }

  /** Drags with the mouse, without showing the pointer (for arranging the layout). */
  async drag(from, to) {
    await this.page.mouse.move(from.x, from.y);
    await this.page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await this.page.mouse.move(from.x + (to.x - from.x) * i / 10, from.y + (to.y - from.y) * i / 10);
      await sleep(20);
    }
    await this.page.mouse.up();
    await sleep(200);
  }

  /** Sets the side bar's width and where the second view in it starts. */
  async arrangeSideBar({ width, secondViewTop, secondView }) {
    const sidebar = await this.box('.part.sidebar');
    await this.drag({ x: sidebar.right + 1, y: 300 }, { x: sidebar.left + width + 1, y: 300 });
    const header = await this.box('.part.sidebar .pane-header', secondView);
    const sash = await this.page.evaluate(top => {
      const sashes = [...document.querySelectorAll('.part.sidebar .monaco-sash.horizontal')].map(s => s.getBoundingClientRect());
      const r = sashes.sort((a, b) => Math.abs(a.top - top) - Math.abs(b.top - top))[0];
      return r && { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, header.top);
    if (sash) {
      await this.drag(sash, { x: sash.x, y: secondViewTop });
    }
  }

  /**
   * Draws a mouse pointer in the window, since screenshots don't include the
   * system's. The workbench enforces Trusted Types, so no innerHTML.
   */
  async showPointer(x, y) {
    await this.page.evaluate(() => {
      const ns = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(ns, 'svg');
      svg.id = 'recording-pointer';
      svg.setAttribute('width', '24');
      svg.setAttribute('height', '24');
      svg.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none';
      const arrow = document.createElementNS(ns, 'path');
      arrow.setAttribute('d', 'M1 1 L1 17.5 L5.2 13.6 L8.2 20.6 L11 19.4 L8 12.5 L13.8 12.5 Z');
      arrow.setAttribute('fill', '#fff');
      arrow.setAttribute('stroke', '#000');
      arrow.setAttribute('stroke-width', '1.2');
      arrow.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(arrow);
      document.body.appendChild(svg);
    });
    await this.#setPointer(x, y);
  }

  async hidePointer() {
    await this.#setPointer(-100, -100);
  }

  async #setPointer(x, y) {
    this.#pointer = { x, y };
    await this.page.mouse.move(x, y);
    await this.page.evaluate(([x, y]) => {
      document.getElementById('recording-pointer').style.transform = `translate(${x - 1}px,${y - 1}px)`;
    }, [x, y]);
  }

  /** Moves the pointer smoothly to (x, y) over `ms` milliseconds. */
  async moveTo(x, y, ms = 450) {
    const from = { ...this.#pointer };
    const steps = Math.max(6, Math.round(ms / 25));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      await this.#setPointer(from.x + (x - from.x) * eased, from.y + (y - from.y) * eased);
      await sleep(ms / steps);
    }
  }

  async click(x, y, ms) {
    await this.moveTo(x, y, ms);
    await sleep(120);
    await this.page.mouse.down();
    await sleep(60);
    await this.page.mouse.up();
  }

  /** Clicks just after the last character of a (1-based) line in the active editor. */
  async clickLineEnd(line, ms = 550) {
    const end = await this.page.evaluate(line => {
      const editor = document.querySelector('.editor-instance .monaco-editor');
      const number = [...editor.querySelectorAll('.line-numbers')].find(e => e.textContent.trim() === String(line));
      if (!number) {
        return undefined;
      }
      const y = number.getBoundingClientRect().top + number.getBoundingClientRect().height / 2;
      const text = [...editor.querySelectorAll('.view-line')].find(e => {
        const r = e.getBoundingClientRect();
        return y >= r.top && y < r.bottom;
      });
      const spans = text ? [...text.querySelectorAll('span > span')] : [];
      return spans.length ? { x: spans[spans.length - 1].getBoundingClientRect().right, y } : undefined;
    }, line);
    if (!end) {
      throw new Error(`Line ${line} is not visible`);
    }
    await this.click(end.x + 3, end.y, ms);
  }

  /**
   * Records every repaint of the window until the returned function is
   * called. That function writes the distinct frames to `dir` as PNGs, plus
   * an ffmpeg concat list (`frames.txt`) that shows each for as long as it
   * was on screen, and returns the list's path.
   */
  async record(dir) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const frames = [];
    const cdp = await this.page.context().newCDPSession(this.page);
    cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
      frames.push({ time: metadata.timestamp * 1000, png: Buffer.from(data, 'base64') });
      cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });

    return async () => {
      await cdp.send('Page.stopScreencast');
      const end = Date.now();
      const kept = [];
      frames.forEach((frame, i) => {
        const until = frames[i + 1]?.time ?? end;
        if (kept.length && frame.png.equals(frames[i - 1].png)) {
          kept[kept.length - 1].until = until;
          return;
        }
        const file = path.join(dir, `frame${String(kept.length).padStart(4, '0')}.png`);
        writeFileSync(file, frame.png);
        kept.push({ file, from: frame.time, until });
      });
      if (!kept.length) {
        throw new Error('No frames were recorded');
      }
      const list = path.join(dir, 'frames.txt');
      writeFileSync(list, [
        ...kept.map(f => `file '${f.file}'\nduration ${((f.until - f.from) / 1000).toFixed(3)}`),
        // The concat demuxer ignores the last entry's duration unless it's repeated.
        `file '${kept[kept.length - 1].file}'`,
      ].join('\n') + '\n');
      return list;
    };
  }
}
