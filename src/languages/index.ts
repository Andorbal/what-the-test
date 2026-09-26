import { LanguageAdapter } from '../core/languageAdapter';
import { CSharpAdapter } from './csharp/csharpAdapter';
import { FSharpAdapter } from './fsharp/fsharpAdapter';
import { GoAdapter } from './go/goAdapter';
import { JavaAdapter } from './java/javaAdapter';
import { JavaScriptAdapter } from './javascript/javascriptAdapter';
import { PythonAdapter } from './python/pythonAdapter';

/** Adapters that ship with the extension. Add new languages here. */
export function builtInAdapters(): LanguageAdapter[] {
  return [new CSharpAdapter(), new FSharpAdapter(), new GoAdapter(), new JavaAdapter(), new JavaScriptAdapter(), new PythonAdapter()];
}
