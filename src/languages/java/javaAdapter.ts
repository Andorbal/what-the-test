import * as vscode from 'vscode';
import { LanguageAdapter } from '../../core/languageAdapter';
import { ParsedTestFile } from '../../core/types';
import { DEFAULT_JAVA_TEST_ANNOTATIONS, parseJavaTests } from './javaTestParser';

/** Java: JUnit 5 and 4, TestNG and jqwik. */
export class JavaAdapter implements LanguageAdapter {
  readonly id = 'java';
  readonly displayName = 'Java';
  readonly languageIds = ['java'];

  isTestFile(document: vscode.TextDocument): boolean {
    const annotations = this.testAnnotations().join('|');
    return new RegExp(`@\\s*(?:[\\w.]+\\.)?(?:${annotations})\\b`).test(document.getText());
  }

  parseTests(document: vscode.TextDocument): ParsedTestFile {
    return parseJavaTests(document.getText(), { testAnnotations: this.testAnnotations() });
  }

  private testAnnotations(): string[] {
    const extra = vscode.workspace.getConfiguration('whatTheTest.java').get<string[]>('additionalTestAnnotations', []);
    return [...DEFAULT_JAVA_TEST_ANNOTATIONS, ...extra];
  }
}
