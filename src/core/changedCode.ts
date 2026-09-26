import * as vscode from 'vscode';
import { changedLines } from './lineDiff';

/** Lines of a document that changed. */
export interface ChangedCode {
  readonly document: vscode.TextDocument;
  /** Zero-based line numbers, ascending. */
  readonly lines: readonly number[];
}

/** The parts of the built-in Git extension's API (`git.d.ts`) that are used here. */
interface GitExtension {
  readonly enabled: boolean;
  getAPI(version: 1): GitApi;
}
interface GitApi {
  readonly state: 'uninitialized' | 'initialized';
  readonly onDidChangeState: vscode.Event<'uninitialized' | 'initialized'>;
  readonly repositories: GitRepository[];
  getRepository(uri: vscode.Uri): GitRepository | null;
}
interface GitRepository {
  readonly state: {
    readonly mergeChanges: readonly { readonly uri: vscode.Uri }[];
    readonly indexChanges: readonly { readonly uri: vscode.Uri }[];
    readonly workingTreeChanges: readonly { readonly uri: vscode.Uri }[];
    readonly untrackedChanges?: readonly { readonly uri: vscode.Uri }[];
  };
  show(ref: string, path: string): Promise<string>;
}

/**
 * Finds the code that changed since the last commit: saved and unsaved edits
 * to files in Git repositories, compared with `HEAD`. Files outside a
 * repository only count while they have unsaved edits, compared with the
 * file on disk. Only documents that `include` accepts are returned.
 */
export async function uncommittedChanges(include: (document: vscode.TextDocument) => boolean): Promise<ChangedCode[]> {
  const git = await gitApi();
  const uris = new Map<string, vscode.Uri>();
  for (const repo of git?.repositories ?? []) {
    const { mergeChanges, indexChanges, workingTreeChanges, untrackedChanges = [] } = repo.state;
    for (const change of [...mergeChanges, ...indexChanges, ...workingTreeChanges, ...untrackedChanges]) {
      uris.set(change.uri.toString(), change.uri);
    }
  }
  for (const document of vscode.workspace.textDocuments) {
    if (document.isDirty && document.uri.scheme === 'file') {
      uris.set(document.uri.toString(), document.uri);
    }
  }

  const changes: ChangedCode[] = [];
  for (const uri of uris.values()) {
    const document = await openDocument(uri);
    if (!document || !include(document)) {
      continue;
    }
    const repo = git?.getRepository(uri);
    let base: string | undefined;
    if (repo) {
      // Files that aren't in HEAD (new or untracked) are new in their entirety.
      base = await repo.show('HEAD', uri.fsPath).catch(() => '');
    } else if (document.isDirty) {
      base = await savedText(uri);
    }
    const lines = base === undefined ? [] : changedLines(base, document.getText());
    if (lines.length) {
      changes.push({ document, lines });
    }
  }
  return changes;
}

/** The contents of a file on disk, or undefined if it can't be read. */
export async function savedText(uri: vscode.Uri): Promise<string | undefined> {
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined;
  }
}

async function gitApi(): Promise<GitApi | undefined> {
  try {
    const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
    const exports = extension && (extension.isActive ? extension.exports : await extension.activate());
    if (!exports?.enabled) {
      return undefined;
    }
    const api = exports.getAPI(1);
    if (api.state !== 'initialized') {
      // The first scan for repositories is usually quick; don't wait forever.
      await new Promise<void>(resolve => {
        const timer = setTimeout(done, 5000);
        const listener = api.onDidChangeState(state => state === 'initialized' && done());
        function done() {
          clearTimeout(timer);
          listener.dispose();
          resolve();
        }
      });
    }
    return api;
  } catch {
    return undefined;
  }
}

async function openDocument(uri: vscode.Uri): Promise<vscode.TextDocument | undefined> {
  try {
    return await vscode.workspace.openTextDocument(uri);
  } catch {
    return undefined; // deleted, binary, too large, ...
  }
}
