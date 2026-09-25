import * as vscode from 'vscode';
import { ParsedTestFile, TestDeclaration } from './types';

/**
 * Everything the extension needs to know about a language. Adding support for
 * a new language means implementing this interface and registering it with
 * the {@link AdapterRegistry} (or through the extension's exported API).
 *
 * The heavy lifting that is common to all languages (walking the call graph
 * with the language server, talking to VS Code's Testing infrastructure, the
 * UI) is language agnostic; an adapter only needs to recognise tests.
 */
export interface LanguageAdapter {
  /** Stable identifier, e.g. `csharp`. */
  readonly id: string;
  readonly displayName: string;
  /**
   * VS Code language IDs handled by this adapter. Editors in these languages
   * show covering tests, and files in these languages are checked for tests.
   */
  readonly languageIds: readonly string[];

  /**
   * Cheap check for whether a document may contain tests. Called for every
   * file reached while walking the call graph, before {@link parseTests}.
   */
  isTestFile(document: vscode.TextDocument): boolean;

  /** Finds tests, suites and setup regions in a document. */
  parseTests(document: vscode.TextDocument): ParsedTestFile;

  /**
   * Optionally overrides how a parsed declaration is matched to the test IDs
   * that VS Code's test controllers report for its file. Each candidate is an
   * ID split into segments, starting with the controller ID. Return the
   * matching candidate, or undefined to fall back to running by location.
   */
  matchTestId?(declaration: TestDeclaration, candidates: readonly (readonly string[])[]): readonly string[] | undefined;
}
