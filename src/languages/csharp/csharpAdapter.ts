import * as vscode from 'vscode';
import { LanguageAdapter } from '../../core/languageAdapter';
import { ParsedTestFile } from '../../core/types';
import { DEFAULT_TEST_ATTRIBUTES, parseCSharpTests } from './csharpTestParser';

/** C#/.NET: xUnit, NUnit, MSTest and friends, run through C# Dev Kit or any other test controller. */
export class CSharpAdapter implements LanguageAdapter {
  readonly id = 'csharp';
  readonly displayName = 'C#';
  readonly languageIds = ['csharp'];

  isTestFile(document: vscode.TextDocument): boolean {
    const attributes = this.testAttributes().join('|');
    return new RegExp(`\\[\\s*(?:[\\w.]+\\.)?(?:${attributes})(?:Attribute)?\\b`).test(document.getText());
  }

  parseTests(document: vscode.TextDocument): ParsedTestFile {
    return parseCSharpTests(document.getText(), { testAttributes: this.testAttributes() });
  }

  private testAttributes(): string[] {
    const extra = vscode.workspace.getConfiguration('whatTheTest.csharp').get<string[]>('additionalTestAttributes', []);
    return [...DEFAULT_TEST_ATTRIBUTES, ...extra];
  }
}
