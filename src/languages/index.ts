import { LanguageAdapter } from '../core/languageAdapter';
import { CSharpAdapter } from './csharp/csharpAdapter';
import { JavaScriptAdapter } from './javascript/javascriptAdapter';

/** Adapters that ship with the extension. Add new languages here. */
export function builtInAdapters(): LanguageAdapter[] {
  return [new CSharpAdapter(), new JavaScriptAdapter()];
}
