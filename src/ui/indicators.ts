import * as vscode from 'vscode';
import { LineTestsService, LineTestsState } from './lineTestsService';
import { covers, noTestsMessage, pluralTests } from './format';

/** The status bar item and the hint shown at the end of the current line. */
export class LineIndicators implements vscode.Disposable {
  private readonly statusBar = vscode.window.createStatusBarItem('whatTheTest.status', vscode.StatusBarAlignment.Right, 100);
  private readonly decoration = vscode.window.createTextEditorDecorationType({
    after: {
      color: new vscode.ThemeColor('editorCodeLens.foreground'),
      fontStyle: 'italic',
      margin: '0 0 0 3em',
    },
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
  });
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly service: LineTestsService) {
    this.statusBar.name = 'What the Test';
    this.statusBar.command = 'whatTheTest.showTestsForLine';
    this.disposables.push(
      this.statusBar,
      this.decoration,
      service.onDidChangeState(state => this.render(state)),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('whatTheTest')) {
          this.render(service.state);
        }
      }),
    );
    this.render(service.state);
  }

  private render(state: LineTestsState): void {
    const config = vscode.workspace.getConfiguration('whatTheTest');
    this.renderStatusBar(state, config.get<boolean>('showStatusBar', true));
    this.renderDecoration(state, config.get<boolean>('showInlineCount', true));
  }

  private renderStatusBar(state: LineTestsState, enabled: boolean): void {
    const pinned = this.service.pinned;
    if (!enabled || state.status === 'idle' || (state.status === 'ready' && state.result.enclosingTest && !pinned)) {
      this.statusBar.hide();
      return;
    }
    const pin = pinned ? ' $(pinned)' : '';
    if (state.status === 'loading') {
      this.statusBar.text = `$(loading~spin) Tests${pin}`;
      this.statusBar.tooltip = `Finding tests that cover line ${state.line + 1}…`;
    } else {
      const { result } = state;
      const count = result.tests.length;
      this.statusBar.text = `$(beaker) ${count}${result.truncated ? '+' : ''}${pin}`;
      // The list may be for another line: it is pinned, or the cursor is in one of its tests.
      const editor = vscode.window.activeTextEditor;
      const where = editor?.document.uri.toString() === result.uri.toString() && editor.selection.active.line === result.line
        ? `line ${result.line + 1}`
        : `${vscode.workspace.asRelativePath(result.uri)}:${result.line + 1}`;
      this.statusBar.tooltip = count
        ? `${pluralTests(count)} ${covers(count)} ${where}${result.symbolName ? ` (${result.symbolName})` : ''}${pinned ? ' (pinned)' : ''}. Click to show, go to or run them.`
        : noTestsMessage(result);
    }
    this.statusBar.show();
  }

  private renderDecoration(state: LineTestsState, enabled: boolean): void {
    for (const editor of vscode.window.visibleTextEditors) {
      editor.setDecorations(this.decoration, []);
    }
    const editor = vscode.window.activeTextEditor;
    if (!enabled || state.status !== 'ready' || !editor || editor.document.uri.toString() !== state.result.uri.toString()) {
      return;
    }
    const { result } = state;
    if (!result.tests.length || result.line >= editor.document.lineCount) {
      return;
    }
    const end = editor.document.lineAt(result.line).range.end;
    const suffix = result.truncated ? '+' : '';
    editor.setDecorations(this.decoration, [{
      range: new vscode.Range(end, end),
      renderOptions: { after: { contentText: `⚗ ${pluralTests(result.tests.length)}${suffix}` } },
    }]);
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
