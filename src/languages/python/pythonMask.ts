import { blank } from '../text';

const PREFIX = /[rRbBuUfFtT]/;

/**
 * Masks comments and the contents of string literals in Python source,
 * including triple-quoted strings, string prefixes (`r`, `b`, `f`, ...) and
 * the expressions inside f-strings, keeping the quotes.
 */
export function maskPython(text: string): string {
  const out = text.split('');
  const n = text.length;
  let i = 0;
  while (i < n) {
    const ch = text[i];
    if (ch === '#') {
      let j = i;
      while (j < n && text[j] !== '\n') {
        j++;
      }
      blank(text, i, j, out);
      i = j;
    } else if (ch === '"' || ch === "'") {
      const formatted = isFormatted(text, i);
      const triple = text.startsWith(ch.repeat(3), i);
      const contentStart = i + (triple ? 3 : 1);
      const end = scanString(text, contentStart, ch, triple, formatted);
      blank(text, contentStart, Math.max(contentStart, end - (triple ? 3 : 1)), out);
      i = end;
    } else {
      i++;
    }
  }
  return out.join('');
}

/** True if the quote at `quote` starts an f-string (or t-string), judging by its prefix. */
function isFormatted(text: string, quote: number): boolean {
  let start = quote;
  while (start > 0 && quote - start < 2 && PREFIX.test(text[start - 1])) {
    start--;
  }
  if (start > 0 && /[\w]/.test(text[start - 1])) {
    return false; // an identifier that happens to end in r/b/f, e.g. `buf"` isn't valid anyway
  }
  return /[fFtT]/.test(text.slice(start, quote));
}

/** Returns the offset just past the closing quote(s). */
function scanString(text: string, start: number, quote: string, triple: boolean, formatted: boolean): number {
  const n = text.length;
  const closing = triple ? quote.repeat(3) : quote;
  let j = start;
  while (j < n) {
    const c = text[j];
    if (c === '\\') {
      j += 2;
      continue;
    }
    if (text.startsWith(closing, j)) {
      return j + closing.length;
    }
    if (!triple && c === '\n') {
      return j; // unterminated
    }
    if (formatted && c === '{') {
      if (text[j + 1] === '{') {
        j += 2;
        continue;
      }
      // An expression, which may itself contain strings (Python 3.12+).
      let depth = 1;
      j++;
      while (j < n && depth > 0) {
        const e = text[j];
        if (e === '{') {
          depth++;
        } else if (e === '}') {
          depth--;
        } else if (e === '"' || e === "'") {
          const nestedTriple = text.startsWith(e.repeat(3), j);
          j = scanString(text, j + (nestedTriple ? 3 : 1), e, nestedTriple, isFormatted(text, j)) - 1;
        }
        j++;
      }
      continue;
    }
    j++;
  }
  return n;
}
