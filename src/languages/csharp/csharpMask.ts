import { blank } from '../text';

/**
 * Masks comments and the contents of string and character literals in C#
 * source, including verbatim (`@"..."`), interpolated (`$"..."`, `$@"..."`)
 * and raw (`"""..."""`) strings. Interpolation holes are masked too, since
 * nothing inside a string can declare a test.
 */
export function maskCSharp(text: string): string {
  const out = text.split('');
  const n = text.length;
  let i = 0;

  while (i < n) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '/' && next === '/') {
      let j = i;
      while (j < n && text[j] !== '\n') {
        j++;
      }
      blank(text, i, j, out);
      i = j;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      const j = end === -1 ? n : end + 2;
      blank(text, i, j, out);
      i = j;
      continue;
    }
    if (ch === "'") {
      let j = i + 1;
      while (j < n && text[j] !== "'" && text[j] !== '\n') {
        j += text[j] === '\\' ? 2 : 1;
      }
      blank(text, i + 1, Math.min(j, n), out);
      i = j + 1;
      continue;
    }

    // String prefixes: $, @, $@, @$, $$ (raw interpolated)
    let p = i;
    let verbatim = false;
    let interpolated = false;
    while (p < n && (text[p] === '$' || text[p] === '@')) {
      if (text[p] === '@') {
        verbatim = true;
      } else {
        interpolated = true;
      }
      p++;
    }
    if (text[p] !== '"' || (p > i && isIdentifierBefore(text, i))) {
      i++;
      continue;
    }

    const contentStart = p + 1;
    let end: number;
    if (text.startsWith('"""', p)) {
      let quotes = 3;
      while (text[p + quotes] === '"') {
        quotes++;
      }
      const closing = '"'.repeat(quotes);
      const found = text.indexOf(closing, p + quotes);
      end = found === -1 ? n : found + quotes;
      blank(text, p + quotes, found === -1 ? n : found, out);
    } else {
      end = scanRegularString(text, contentStart, verbatim, interpolated);
      blank(text, contentStart, Math.max(contentStart, end - 1), out);
    }
    i = end;
  }
  return out.join('');
}

function isIdentifierBefore(text: string, i: number): boolean {
  return i > 0 && /[\w]/.test(text[i - 1]);
}

/** Returns the offset just past the closing quote. */
function scanRegularString(text: string, start: number, verbatim: boolean, interpolated: boolean): number {
  const n = text.length;
  let j = start;
  while (j < n) {
    const c = text[j];
    if (!verbatim && c === '\\') {
      j += 2;
      continue;
    }
    if (c === '"') {
      if (verbatim && text[j + 1] === '"') {
        j += 2;
        continue;
      }
      return j + 1;
    }
    if (!verbatim && c === '\n') {
      return j;
    }
    if (interpolated && c === '{') {
      if (text[j + 1] === '{') {
        j += 2;
        continue;
      }
      j = skipInterpolationHole(text, j + 1);
      continue;
    }
    j++;
  }
  return n;
}

function skipInterpolationHole(text: string, start: number): number {
  let depth = 1;
  let j = start;
  while (j < text.length && depth > 0) {
    const c = text[j];
    if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
    } else if (c === '"') {
      // A nested (non-verbatim) string inside the hole.
      j = scanRegularString(text, j + 1, false, false);
      continue;
    }
    j++;
  }
  return j;
}
