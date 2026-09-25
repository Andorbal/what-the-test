import * as vscode from 'vscode';
import { LanguageAdapter } from '../../core/languageAdapter';
import { ParsedTestFile } from '../../core/types';
import { DEFAULT_SUITE_FUNCTIONS, DEFAULT_TEST_FUNCTIONS, parseJavaScriptTests } from './jsTestParser';

const TEST_FILE_NAME = /(\.|_|-)(test|spec|e2e|bench)\.[cm]?[jt]sx?$|[\\/]__tests__[\\/]|[\\/]tests?[\\/]/i;

/** TypeScript and JavaScript: Jest, Vitest, Mocha, Jasmine, node:test, Playwright, ... */
export class JavaScriptAdapter implements LanguageAdapter {
  readonly id = 'javascript';
  readonly displayName = 'TypeScript/JavaScript';
  readonly languageIds = ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'];

  isTestFile(document: vscode.TextDocument): boolean {
    if (TEST_FILE_NAME.test(document.uri.path)) {
      return true;
    }
    // Test files with unconventional names: look for a test call at the start of a line.
    const names = [...DEFAULT_TEST_FUNCTIONS, ...this.config('additionalTestFunctions')].join('|');
    return new RegExp(`^\\s*(?:${names})(?:\\.\\w+)*\\s*\\(\\s*['"\`]`, 'm').test(document.getText());
  }

  parseTests(document: vscode.TextDocument): ParsedTestFile {
    return parseJavaScriptTests(document.getText(), {
      testFunctions: [...DEFAULT_TEST_FUNCTIONS, ...this.config('additionalTestFunctions')],
      suiteFunctions: [...DEFAULT_SUITE_FUNCTIONS, ...this.config('additionalSuiteFunctions')],
    });
  }

  private config(key: string): string[] {
    return vscode.workspace.getConfiguration('whatTheTest.javascript').get<string[]>(key, []);
  }
}
