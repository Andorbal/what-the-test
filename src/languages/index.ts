import { LanguageAdapter } from '../core/languageAdapter';
import { CSharpAdapter } from './csharp/csharpAdapter';
import { FSharpAdapter } from './fsharp/fsharpAdapter';
import { JavaScriptAdapter } from './javascript/javascriptAdapter';

/** Adapters that ship with the extension. Add new languages here. */
export function builtInAdapters(): LanguageAdapter[] {
  return [new CSharpAdapter(), new FSharpAdapter(), new JavaScriptAdapter()];
}
