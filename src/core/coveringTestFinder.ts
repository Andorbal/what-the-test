import * as vscode from 'vscode';
import { AdapterRegistry } from './adapterRegistry';
import { LanguageAdapter } from './languageAdapter';
import { TestDeclaration, declarationAt, innermostDeclaration } from './types';

/** A test (or suite) that exercises a given line of code. */
export interface CoveringTest {
  /** Unique, serializable key: `<uri>#<line>:<character>`. */
  readonly key: string;
  readonly uri: vscode.Uri;
  readonly declaration: TestDeclaration;
  readonly adapter: LanguageAdapter;
  /** Number of calls between the test and the line; 1 when the test calls it directly. */
  readonly distance: number;
  /** Names of the functions between the test and the line, nearest to the test first. */
  readonly via: readonly string[];
}

export interface LineTestsResult {
  readonly uri: vscode.Uri;
  readonly line: number;
  /** Name of the symbol the line belongs to, when there is one. */
  readonly symbolName?: string;
  /**
   * The test that contains the line, or the suite when the line is in a setup
   * region such as `beforeEach`. Lines of test code aren't searched for
   * covering tests, so `tests` is empty when this is set.
   */
  readonly enclosingTest?: TestDeclaration;
  readonly tests: readonly CoveringTest[];
  /** True when the search stopped early because it hit the configured limits. */
  readonly truncated: boolean;
}

export interface FinderOptions {
  maxDepth: number;
  maxVisited: number;
}

/** Symbol kinds that represent code which can be called or referenced. */
const MEMBER_KINDS = new Set([
  vscode.SymbolKind.Method, vscode.SymbolKind.Function, vscode.SymbolKind.Constructor,
  vscode.SymbolKind.Property, vscode.SymbolKind.Field, vscode.SymbolKind.Variable,
  vscode.SymbolKind.Constant, vscode.SymbolKind.Event, vscode.SymbolKind.Operator,
  vscode.SymbolKind.EnumMember,
]);
const TYPE_KINDS = new Set([
  vscode.SymbolKind.Class, vscode.SymbolKind.Struct, vscode.SymbolKind.Interface,
  vscode.SymbolKind.Enum, vscode.SymbolKind.Object,
]);

interface Node {
  /** Where to ask the language server about this symbol. */
  uri: vscode.Uri;
  position: vscode.Position;
  name: string;
  /** Call hierarchy item, if the language server provided one. */
  item?: vscode.CallHierarchyItem;
  depth: number;
  /** The `via` of tests that call this node: the functions between them and the line, nearest to the test first. */
  callerVia: string[];
}

/** A member of a supertype that a method implements or overrides. */
interface Abstraction {
  uri: vscode.Uri;
  position: vscode.Position;
  /** e.g. `IShape.Area`. */
  name: string;
}

/**
 * Finds the tests that reach a line of code by walking *up* the call graph
 * with the language server's call hierarchy (falling back to "find all
 * references" where call hierarchy isn't available), stopping whenever a call
 * site sits inside a test that a {@link LanguageAdapter} recognises.
 *
 * This is a static approximation of coverage: it works without running
 * anything and for every language whose extension provides call hierarchy or
 * references, which covers C# (C# / C# Dev Kit) and TS/JS (built in).
 */
export class CoveringTestFinder {
  private readonly symbolCache = new Map<string, { version: number; symbols: vscode.DocumentSymbol[] }>();
  private readonly resultCache = new Map<string, LineTestsResult>();
  /** Workspace supertypes of a type (by its location), all the way up. */
  private readonly supertypeCache = new Map<string, Promise<vscode.TypeHierarchyItem[]>>();

  constructor(private readonly registry: AdapterRegistry) {}

  clearCache(): void {
    this.symbolCache.clear();
    this.resultCache.clear();
    this.supertypeCache.clear();
    this.registry.clearCache();
  }

  async findTestsForLine(
    document: vscode.TextDocument,
    line: number,
    options: FinderOptions,
    token: vscode.CancellationToken,
  ): Promise<LineTestsResult> {
    const text = document.lineAt(line);
    const position = new vscode.Position(line, text.firstNonWhitespaceCharacterIndex);
    const found = new Map<string, CoveringTest>();
    const empty: LineTestsResult = { uri: document.uri, line, tests: [], truncated: false };

    // Test code isn't covered by other tests; listing the test itself would only confuse.
    const own = this.registry.parseTestFile(document);
    const enclosingTest = own && declarationAt(own.parsed, position);
    if (enclosingTest) {
      return { ...empty, symbolName: enclosingTest.name, enclosingTest };
    }

    const symbol = await this.enclosingSymbol(document, position);
    if (!symbol || token.isCancellationRequested) {
      return empty;
    }

    const cacheKey = `${document.uri}@${document.version}#${symbol.selectionRange.start.line}:${symbol.selectionRange.start.character}`;
    const cached = this.resultCache.get(cacheKey);
    if (cached) {
      return { ...cached, line };
    }

    const truncated = await this.walkCallers(document.uri, symbol, found, options, token);
    const tests = [...found.values()].sort((a, b) =>
      a.distance - b.distance || a.uri.toString().localeCompare(b.uri.toString()) ||
      a.declaration.range.start.line - b.declaration.range.start.line);
    const result: LineTestsResult = { uri: document.uri, line, symbolName: displayName(symbol.name), tests, truncated };
    // Results without tests aren't cached either: they are cheap to recompute,
    // and may just mean the language server hasn't indexed the workspace yet.
    if (!token.isCancellationRequested && tests.length) {
      this.resultCache.set(cacheKey, result);
    }
    return result;
  }

  private async walkCallers(
    uri: vscode.Uri,
    symbol: vscode.DocumentSymbol,
    found: Map<string, CoveringTest>,
    options: FinderOptions,
    token: vscode.CancellationToken,
  ): Promise<boolean> {
    const visited = new Set<string>();
    const queue: Node[] = [];
    /**
     * Queues a symbol whose callers should be searched. `parentVia` is the
     * `via` of tests that call the node it was found from; `label` replaces
     * the language server's name for the symbol.
     */
    const enqueue = async (node: Omit<Node, 'item' | 'callerVia'>, parentVia: string[] | undefined, label?: string) => {
      const add = (n: Omit<Node, 'callerVia'>) => {
        const key = `${n.uri}#${n.position.line}:${n.position.character}`;
        if (!visited.has(key)) {
          visited.add(key);
          queue.push({ ...n, callerVia: parentVia ? [label ?? displayName(n.name), ...parentVia] : [] });
        }
      };
      const items = await this.prepareCallHierarchy(node.uri, node.position);
      if (items.length) {
        for (const item of items) {
          add({ ...node, uri: item.uri, position: item.selectionRange.start, name: item.name, item });
        }
      } else {
        add(node);
      }
    };

    await enqueue({ uri, position: symbol.selectionRange.start, name: symbol.name, depth: 0 }, undefined);

    while (queue.length) {
      if (token.isCancellationRequested) {
        return false;
      }
      if (visited.size > options.maxVisited) {
        return true;
      }
      const node = queue.shift()!;
      const via = node.callerVia;
      // Calls through an interface or base class may reach this method too:
      // search the callers of the members it implements or overrides.
      for (const abstraction of await this.abstractions(node)) {
        await enqueue({ uri: abstraction.uri, position: abstraction.position, name: abstraction.name, depth: node.depth }, via, abstraction.name);
      }
      const callSites = await this.callSites(node);
      for (const site of callSites) {
        if (token.isCancellationRequested) {
          return false;
        }
        const doc = await this.openDocument(site.uri);
        if (!doc) {
          continue;
        }
        const testFile = this.registry.parseTestFile(doc);
        // One caller can hold several call sites in different tests: TypeScript
        // reports the calls from all of a file's `it(...)` callbacks as calls from the file.
        let decls = testFile ? site.ranges.map(r => declarationAt(testFile.parsed, r.start)).filter(d => d !== undefined) : [];
        if (testFile && !decls.length && site.caller && isAnonymousCallback(site.caller.name)) {
          // Called directly from a `describe(...)` body, which runs for the whole suite.
          const suite = innermostDeclaration(testFile.parsed, 'suite', site.ranges[0].start);
          decls = suite ? [suite] : [];
        }
        if (testFile && decls.length) {
          for (const decl of decls) {
            this.record(found, site.uri, decl, testFile.adapter, node.depth + 1, via);
          }
          continue;
        }
        if (node.depth + 1 >= options.maxDepth) {
          continue;
        }
        // Anonymous callbacks (`reduce() callback`) are never called by name, so
        // continue from the named function that contains them instead.
        if (site.caller && !isAnonymousCallback(site.caller.name)) {
          const key = `${site.caller.uri}#${site.caller.selectionRange.start.line}:${site.caller.selectionRange.start.character}`;
          if (!visited.has(key)) {
            visited.add(key);
            queue.push({
              uri: site.caller.uri, position: site.caller.selectionRange.start, name: site.caller.name,
              item: site.caller, depth: node.depth + 1, callerVia: [displayName(site.caller.name), ...via],
            });
          }
        } else {
          // A plain reference: continue from whatever symbol contains it.
          const container = await this.enclosingSymbol(doc, site.ranges[0].start);
          if (container) {
            await enqueue({ uri: site.uri, position: container.selectionRange.start, name: container.name, depth: node.depth + 1 }, via);
          }
        }
      }
    }
    return false;
  }

  /**
   * The members of the node's supertypes (in the workspace) that it
   * implements or overrides: those with the same name. Uses the language
   * server's type hierarchy; returns nothing if there is none, as for
   * TypeScript, whose call hierarchy already includes calls through
   * interfaces and base classes.
   */
  private async abstractions(node: Node): Promise<Abstraction[]> {
    const doc = await this.openDocument(node.uri);
    if (!doc) {
      return [];
    }
    const owner = memberAndType(await this.documentSymbols(doc), node.position);
    if (!owner) {
      return [];
    }
    const memberName = displayName(owner.member.name);
    const result: Abstraction[] = [];
    for (const supertype of await this.supertypes(doc.uri, owner.type.selectionRange.start)) {
      const superDoc = await this.openDocument(supertype.uri);
      const superSymbols = superDoc ? await this.documentSymbols(superDoc) : [];
      const type = findSymbol(superSymbols, s => TYPE_KINDS.has(s.kind) && s.selectionRange.contains(supertype.selectionRange.start));
      for (const member of type?.children ?? []) {
        if (MEMBER_KINDS.has(member.kind) && displayName(member.name) === memberName) {
          result.push({ uri: supertype.uri, position: member.selectionRange.start, name: `${displayName(supertype.name)}.${memberName}` });
        }
      }
    }
    return result;
  }

  /** All supertypes of the type at a position that are declared in the workspace. */
  private supertypes(uri: vscode.Uri, position: vscode.Position): Promise<vscode.TypeHierarchyItem[]> {
    const key = `${uri}#${position.line}:${position.character}`;
    let cached = this.supertypeCache.get(key);
    if (!cached) {
      cached = (async () => {
        const found = new Map<string, vscode.TypeHierarchyItem>();
        let level = await this.execute<vscode.TypeHierarchyItem[]>('vscode.prepareTypeHierarchy', uri, position);
        for (let depth = 0; depth < 10 && level.length; depth++) {
          const next: vscode.TypeHierarchyItem[] = [];
          for (const item of level) {
            for (const supertype of await this.execute<vscode.TypeHierarchyItem[]>('vscode.provideSupertypes', item)) {
              const superKey = `${supertype.uri}#${supertype.selectionRange.start.line}:${supertype.selectionRange.start.character}`;
              // Types outside the workspace (System.Object, IDisposable, ...) have far too many callers to be useful.
              if (!found.has(superKey) && vscode.workspace.getWorkspaceFolder(supertype.uri)) {
                found.set(superKey, supertype);
                next.push(supertype);
              }
            }
          }
          level = next;
        }
        return [...found.values()];
      })();
      this.supertypeCache.set(key, cached);
    }
    return cached;
  }

  /** Places that call (or reference) the node's symbol. */
  private async callSites(node: Node): Promise<{ uri: vscode.Uri; ranges: vscode.Range[]; caller?: vscode.CallHierarchyItem }[]> {
    if (node.item) {
      const incoming = await this.execute<vscode.CallHierarchyIncomingCall[]>('vscode.provideIncomingCalls', node.item);
      if (incoming.length) {
        return incoming.map(call => ({
          uri: call.from.uri,
          ranges: call.fromRanges.length ? call.fromRanges : [call.from.selectionRange],
          caller: call.from,
        }));
      }
    }
    // No call hierarchy (or no calls, e.g. for a property or field): use references.
    const refs = await this.execute<vscode.Location[]>('vscode.executeReferenceProvider', node.uri, node.position);
    return refs
      .filter(ref => !(ref.uri.toString() === node.uri.toString() && ref.range.contains(node.position)))
      .map(ref => ({ uri: ref.uri, ranges: [ref.range] }));
  }

  private record(
    found: Map<string, CoveringTest>,
    uri: vscode.Uri,
    declaration: TestDeclaration,
    adapter: LanguageAdapter,
    distance: number,
    via: readonly string[],
  ): void {
    const key = `${uri}#${declaration.range.start.line}:${declaration.range.start.character}`;
    const existing = found.get(key);
    if (!existing || existing.distance > distance) {
      found.set(key, { key, uri, declaration, adapter, distance, via });
    }
  }

  private async prepareCallHierarchy(uri: vscode.Uri, position: vscode.Position): Promise<vscode.CallHierarchyItem[]> {
    const result = await this.execute<vscode.CallHierarchyItem | vscode.CallHierarchyItem[]>('vscode.prepareCallHierarchy', uri, position);
    return Array.isArray(result) ? result : result ? [result] : [];
  }

  /**
   * The innermost named member (method, function, property, ...) that
   * contains the position, or the innermost type if there is no member.
   * Anonymous callbacks (`map() callback`) are skipped in favour of the
   * function that contains them.
   */
  async enclosingSymbol(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.DocumentSymbol | undefined> {
    const symbols = await this.documentSymbols(document);
    let member: vscode.DocumentSymbol | undefined;
    let type: vscode.DocumentSymbol | undefined;
    const visit = (list: readonly vscode.DocumentSymbol[]) => {
      for (const symbol of list) {
        if (!symbol.range.contains(position)) {
          continue;
        }
        if (MEMBER_KINDS.has(symbol.kind) && !isAnonymousCallback(symbol.name)) {
          member = symbol;
        } else if (TYPE_KINDS.has(symbol.kind)) {
          type = symbol;
          member = undefined;
        }
        visit(symbol.children ?? []);
      }
    };
    visit(symbols);
    return member ?? type;
  }

  private async documentSymbols(document: vscode.TextDocument): Promise<vscode.DocumentSymbol[]> {
    const key = document.uri.toString();
    const cached = this.symbolCache.get(key);
    if (cached && cached.version === document.version) {
      return cached.symbols;
    }
    const raw = await this.execute<(vscode.DocumentSymbol | vscode.SymbolInformation)[]>('vscode.executeDocumentSymbolProvider', document.uri);
    // VS Code returns objects that are both SymbolInformation and DocumentSymbol
    // when the provider supports hierarchy, so check for `children` first.
    const symbols = raw.map(s => ('children' in s ? s : symbolInformationToDocumentSymbol(s)));
    // An empty answer usually means the language server is still starting, so don't cache it.
    if (symbols.length) {
      this.symbolCache.set(key, { version: document.version, symbols });
    }
    return symbols;
  }

  private async openDocument(uri: vscode.Uri): Promise<vscode.TextDocument | undefined> {
    try {
      return await vscode.workspace.openTextDocument(uri);
    } catch {
      return undefined;
    }
  }

  private async execute<T>(command: string, ...args: unknown[]): Promise<T | never[]> {
    try {
      return (await vscode.commands.executeCommand<T>(command, ...args)) ?? [];
    } catch {
      return [];
    }
  }
}

/**
 * Language servers decorate names differently; strip parameter lists and
 * return types, e.g. Roslyn's `Calculator.Sum(IEnumerable<int>)` or
 * `Add(int, int) : int`, and F# self-identifiers such as `this.Sum`.
 */
export function displayName(name: string): string {
  const paren = name.indexOf('(');
  return (paren > 0 ? name.slice(0, paren) : name).trim().replace(/^(?:this|self|_|__|x)\./, '');
}

/** TypeScript names anonymous functions after their call site, e.g. `describe('x') callback`. */
function isAnonymousCallback(name: string): boolean {
  return /\bcallback$/.test(name) || name === '<function>' || name === '<anonymous>';
}

/** The member whose name is at `position`, and the innermost type that contains it. */
function memberAndType(symbols: readonly vscode.DocumentSymbol[], position: vscode.Position): { member: vscode.DocumentSymbol; type: vscode.DocumentSymbol } | undefined {
  for (const symbol of symbols) {
    if (!symbol.range.contains(position)) {
      continue;
    }
    if (TYPE_KINDS.has(symbol.kind)) {
      const nested = memberAndType(symbol.children ?? [], position);
      if (nested) {
        return nested;
      }
      const member = symbol.children?.find(c => MEMBER_KINDS.has(c.kind) && c.selectionRange.contains(position));
      return member && { member, type: symbol };
    }
    const nested = memberAndType(symbol.children ?? [], position);
    if (nested) {
      return nested;
    }
  }
  return undefined;
}

function findSymbol(symbols: readonly vscode.DocumentSymbol[], predicate: (symbol: vscode.DocumentSymbol) => boolean): vscode.DocumentSymbol | undefined {
  for (const symbol of symbols) {
    if (predicate(symbol)) {
      return symbol;
    }
    const nested = findSymbol(symbol.children ?? [], predicate);
    if (nested) {
      return nested;
    }
  }
  return undefined;
}

function symbolInformationToDocumentSymbol(info: vscode.SymbolInformation): vscode.DocumentSymbol {
  const range = info.location.range;
  return new vscode.DocumentSymbol(info.name, info.containerName, info.kind, range, range);
}
