import * as vscode from 'vscode';
import { LanguageAdapter } from './languageAdapter';
import { ParsedTestFile } from './types';

export class AdapterRegistry implements vscode.Disposable {
  private readonly adapters: LanguageAdapter[] = [];
  private readonly parseCache = new Map<string, { version: number; parsed: ParsedTestFile | undefined }>();
  private readonly changeEmitter = new vscode.EventEmitter<void>();

  /** Fires when adapters are added or removed. */
  readonly onDidChange = this.changeEmitter.event;

  register(adapter: LanguageAdapter): vscode.Disposable {
    if (this.adapters.some(a => a.id === adapter.id)) {
      throw new Error(`A language adapter with id '${adapter.id}' is already registered.`);
    }
    this.adapters.push(adapter);
    this.parseCache.clear();
    this.changeEmitter.fire();
    return new vscode.Disposable(() => {
      const idx = this.adapters.indexOf(adapter);
      if (idx !== -1) {
        this.adapters.splice(idx, 1);
        this.parseCache.clear();
        this.changeEmitter.fire();
      }
    });
  }

  get all(): readonly LanguageAdapter[] {
    return this.adapters;
  }

  get languageIds(): string[] {
    return [...new Set(this.adapters.flatMap(a => a.languageIds))];
  }

  forDocument(document: vscode.TextDocument): LanguageAdapter | undefined {
    return this.adapters.find(a => a.languageIds.includes(document.languageId));
  }

  /**
   * Returns the parsed tests for a document if it is a test file in a
   * supported language, caching the result per document version.
   */
  parseTestFile(document: vscode.TextDocument): { adapter: LanguageAdapter; parsed: ParsedTestFile } | undefined {
    const adapter = this.forDocument(document);
    if (!adapter) {
      return undefined;
    }
    const key = document.uri.toString();
    let entry = this.parseCache.get(key);
    if (!entry || entry.version !== document.version) {
      const parsed = adapter.isTestFile(document) ? adapter.parseTests(document) : undefined;
      entry = { version: document.version, parsed: parsed?.declarations.length ? parsed : undefined };
      this.parseCache.set(key, entry);
    }
    return entry.parsed ? { adapter, parsed: entry.parsed } : undefined;
  }

  clearCache(): void {
    this.parseCache.clear();
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }
}
