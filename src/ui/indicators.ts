import * as vscode from 'vscode';
import { LineTestsService, LineTestsState } from './lineTestsService';
import { covers, pluralTests } from './format';

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

  constructor(service: LineTestsService) {
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
    if (!enabled || state.status === 'idle') {
      this.statusBar.hide();
      return;
    }
    if (state.status === 'loading') {
      this.statusBar.text = '$(loading~spin) Tests';
      this.statusBar.tooltip = `Finding tests that cover line ${state.line + 1}…`;
    } else {
      const { result } = state;
      const count = result.tests.length;
      this.statusBar.text = `$(beaker) ${count}${result.truncated ? '+' : ''}`;
      this.statusBar.tooltip = count
        ? `${pluralTests(count)} ${covers(count)} line ${result.line + 1}${result.symbolName ? ` (${result.symbolName})` : ''}. Click to show, go to or run them.`
        : `No tests found that cover line ${result.line + 1}.`;
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
