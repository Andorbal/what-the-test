import * as vscode from 'vscode';
import { matchTestId } from '../../core/idMatching';
import { LanguageAdapter } from '../../core/languageAdapter';
import { ParsedTestFile, TestDeclaration } from '../../core/types';
import { parseGoTests } from './goTestParser';

/** Go: `go test` tests, benchmarks, fuzz tests, examples, subtests and testify suites. */
export class GoAdapter implements LanguageAdapter {
  readonly id = 'go';
  readonly displayName = 'Go';
  readonly languageIds = ['go'];

  isTestFile(document: vscode.TextDocument): boolean {
    return document.uri.path.endsWith('_test.go');
  }

  parseTests(document: vscode.TextDocument): ParsedTestFile {
    return parseGoTests(document.getText());
  }

  /**
   * The Go extension only lists a subtest once its parent has run, so a
   * subtest without a test item runs through its parent (by ID) instead.
   */
  matchTestId(declaration: TestDeclaration, candidates: readonly (readonly string[])[]): readonly string[] | undefined {
    for (let length = declaration.path.length; length > 0; length--) {
      const path = declaration.path.slice(0, length);
      const match = matchTestId({ ...declaration, name: path[length - 1], path }, candidates);
      if (match) {
        return match;
      }
    }
    return undefined;
  }
}
