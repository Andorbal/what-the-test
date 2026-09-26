import { blank } from '../text';

/**
 * Masks comments and the contents of string and character literals in F#
 * source: `//` and nested `(* *)` comments, regular, verbatim (`@"..."`),
 * triple-quoted and interpolated (`$"..."`, `$"""..."""`) strings, and
 * character literals. Double-backtick identifiers (``` ``like this`` ```) are
 * left as they are, since they are the names of tests.
 */
export function maskFSharp(text: string): string {
  const out = text.split('');
  const n = text.length;
  let i = 0;

  while (i < n) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '`' && next === '`') {
      const end = text.indexOf('``', i + 2);
      const newline = text.indexOf('\n', i + 2);
      i = end === -1 || (newline !== -1 && newline < end) ? i + 2 : end + 2;
      continue;
    }
    if (ch === '/' && next === '/') {
      let j = i;
      while (j < n && text[j] !== '\n') {
        j++;
      }
      blank(text, i, j, out);
      i = j;
      continue;
    }
    // `(*)` is the multiplication operator, not a comment.
    if (ch === '(' && next === '*' && text[i + 2] !== ')') {
      const j = skipBlockComment(text, i);
      blank(text, i, j, out);
      i = j;
      continue;
    }
    if (ch === "'") {
      const end = charLiteralEnd(text, i);
      if (end !== -1) {
        blank(text, i + 1, end - 1, out);
        i = end;
      } else {
        i++; // a type parameter ('T) or a prime in an identifier (x')
      }
      continue;
    }

    // String prefixes: $, @, $@, @$, $$ ...
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
    if (text[p] !== '"' || (p > i && i > 0 && /\w/.test(text[i - 1]))) {
      i++;
      continue;
    }
    if (text.startsWith('"""', p)) {
      const found = text.indexOf('"""', p + 3);
      blank(text, p + 3, found === -1 ? n : found, out);
      i = found === -1 ? n : found + 3;
      continue;
    }
    const end = scanString(text, p + 1, verbatim, interpolated);
    blank(text, p + 1, Math.max(p + 1, end - 1), out);
    i = end;
  }
  return out.join('');
}

/** Returns the offset just past a (possibly nested) `(* ... *)` comment. */
function skipBlockComment(text: string, start: number): number {
  let depth = 0;
  let j = start;
  while (j < text.length) {
    if (text[j] === '(' && text[j + 1] === '*') {
      depth++;
      j += 2;
    } else if (text[j] === '*' && text[j + 1] === ')') {
      depth--;
      j += 2;
      if (depth === 0) {
        return j;
      }
    } else if (text[j] === '"') {
      // Strings inside comments are skipped, so `"*)"` doesn't end the comment.
      j = scanString(text, j + 1, false, false);
    } else {
      j++;
    }
  }
  return text.length;
}

/** The offset just past a character literal starting at `start`, or -1 if it isn't one. */
function charLiteralEnd(text: string, start: number): number {
  if (start > 0 && /[\w']/.test(text[start - 1])) {
    return -1;
  }
  const m = /^'(?:\\(?:[ntbrafv\\"'0]|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|[0-9]{3}|x[0-9a-fA-F]{2})|[^\\'\n])'B?/.exec(text.slice(start, start + 12));
  return m ? start + m[0].length : -1;
}

/** Returns the offset just past the closing quote of a regular, verbatim or interpolated string. */
function scanString(text: string, start: number, verbatim: boolean, interpolated: boolean): number {
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
    if (interpolated && c === '{') {
      if (text[j + 1] === '{') {
        j += 2;
        continue;
      }
      let depth = 1;
      j++;
      while (j < n && depth > 0) {
        if (text[j] === '{') {
          depth++;
        } else if (text[j] === '}') {
          depth--;
        } else if (text[j] === '"') {
          j = scanString(text, j + 1, false, false) - 1;
        }
        j++;
      }
      continue;
    }
    j++;
  }
  return n;
}
