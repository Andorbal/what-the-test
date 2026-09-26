import * as vscode from 'vscode';
import { LanguageAdapter } from '../../core/languageAdapter';
import { ParsedTestFile } from '../../core/types';
import { DEFAULT_FSHARP_TEST_ATTRIBUTES, parseFSharpTests } from './fsharpTestParser';

const EXPECTO = /\b[pf]?(?:testList|testCase\w*|testProperty\w*|testTheory\w*)\s+(?:\w+\s+)?"/;

/** F#: xUnit, NUnit, MSTest and FsCheck attributes, and Expecto. */
export class FSharpAdapter implements LanguageAdapter {
  readonly id = 'fsharp';
  readonly displayName = 'F#';
  readonly languageIds = ['fsharp'];

  isTestFile(document: vscode.TextDocument): boolean {
    const text = document.getText();
    const attributes = this.testAttributes().join('|');
    return new RegExp(`\\[<\\s*(?:[\\w.]+\\.)?(?:${attributes})(?:Attribute)?\\b`).test(text) || EXPECTO.test(text);
  }

  parseTests(document: vscode.TextDocument): ParsedTestFile {
    return parseFSharpTests(document.getText(), { testAttributes: this.testAttributes() });
  }

  private testAttributes(): string[] {
    const extra = vscode.workspace.getConfiguration('whatTheTest.fsharp').get<string[]>('additionalTestAttributes', []);
    return [...DEFAULT_FSHARP_TEST_ATTRIBUTES, ...extra];
  }
}
