import { TestDeclaration } from './types';

/**
 * Test controllers are free to choose any ID scheme for their test items, so
 * we can't compute a test's ID from its declaration. Instead, we look at the
 * IDs that VS Code reports for the declaration's file and pick the one that
 * best matches the declaration's name and container path. Most controllers
 * (C# Dev Kit, Jest, Mocha, Playwright, node:test, ...) embed names in IDs;
 * for those that don't, the caller falls back to running by location.
 *
 * `candidates` are IDs split into their path segments, with the controller ID
 * as the first segment (the format `vscode.testing.getTestsInFile` returns).
 */
export function matchTestId(decl: TestDeclaration, candidates: readonly (readonly string[])[]): readonly string[] | undefined {
  let best: { parts: readonly string[]; score: number } | undefined;
  for (const parts of candidates) {
    const score = scoreCandidate(decl, parts);
    if (score > 0 && (!best || score > best.score)) {
      best = { parts, score };
    }
  }
  return best?.parts;
}

/** Characters controllers commonly use to separate names inside an ID segment. */
const SEPARATOR = /[\s./\\#:>|,+\-]/;

function nameMatchScore(segment: string, name: string): number {
  if (segment === name) {
    return 10;
  }
  const idx = segment.lastIndexOf(name);
  if (idx === -1) {
    return 0;
  }
  const before = idx === 0 ? '' : segment[idx - 1];
  const after = segment.slice(idx + name.length);
  const boundedBefore = before === '' || SEPARATOR.test(before);
  if (!boundedBefore) {
    return 0;
  }
  if (after === '') {
    return 8; // e.g. `Namespace.Class.Method` or `file.test.ts#suite#name`
  }
  if (after.startsWith('(')) {
    return 5; // a parameterized case such as `Method(a: 1, b: 2)`
  }
  if (SEPARATOR.test(after[0])) {
    return 2; // name followed by more qualifiers
  }
  return 0;
}

function scoreCandidate(decl: TestDeclaration, parts: readonly string[]): number {
  const segments = parts.slice(1); // drop the controller ID
  if (!segments.length) {
    return 0;
  }
  const last = segments[segments.length - 1];
  const nameScore = nameMatchScore(last, decl.name);
  if (nameScore === 0) {
    return 0;
  }

  // Reward containers (describe blocks, classes, namespaces) that appear in
  // the ID, in order, so `A > it` doesn't match `B > it` in the same file.
  const containers = decl.path.slice(0, -1);
  const joined = segments.slice(0, -1).join('\u0000') + '\u0000' + last.slice(0, last.length - decl.name.length);
  let containerScore = 0;
  let from = 0;
  for (const container of containers) {
    const idx = findBounded(joined, container, from);
    if (idx !== -1) {
      containerScore += 3;
      from = idx + container.length;
    } else {
      containerScore -= 1;
    }
  }

  // Prefer the parent over individual data rows / parameterized children.
  const depthPenalty = segments.length * 0.01;
  return 1 + nameScore + containerScore - depthPenalty;
}

function findBounded(haystack: string, needle: string, from: number): number {
  let idx = haystack.indexOf(needle, from);
  while (idx !== -1) {
    const before = idx === 0 ? '' : haystack[idx - 1];
    const after = haystack[idx + needle.length] ?? '';
    const ok = (s: string) => s === '' || s === '\u0000' || SEPARATOR.test(s) || s === '(';
    if (ok(before) && ok(after)) {
      return idx;
    }
    idx = haystack.indexOf(needle, idx + 1);
  }
  return -1;
}
