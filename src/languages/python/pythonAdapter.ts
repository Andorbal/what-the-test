import * as vscode from 'vscode';
import { LanguageAdapter } from '../../core/languageAdapter';
import { ParsedTestFile } from '../../core/types';
import { parsePythonTests } from './pythonTestParser';

/** pytest's and unittest's default file patterns: `test_*.py`, `*_test.py` and `test*.py`. */
const TEST_FILE_NAME = /(?:^test[^/\\]*|_test)\.py$/;

/** Python: pytest and unittest. */
export class PythonAdapter implements LanguageAdapter {
  readonly id = 'python';
  readonly displayName = 'Python';
  readonly languageIds = ['python'];

  isTestFile(document: vscode.TextDocument): boolean {
    return TEST_FILE_NAME.test(basename(document.uri)) || /\bTestCase\b/.test(document.getText());
  }

  parseTests(document: vscode.TextDocument): ParsedTestFile {
    return parsePythonTests(document.getText(), { moduleName: basename(document.uri) });
  }
}

function basename(uri: vscode.Uri): string {
  return uri.path.slice(uri.path.lastIndexOf('/') + 1);
}
