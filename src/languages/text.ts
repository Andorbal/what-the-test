import { TextPosition, TextRange } from '../core/types';

/** Converts string offsets to line/character positions. */
export class LineIndex {
  private readonly lineStarts: number[] = [0];

  constructor(text: string) {
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10 /* \n */) {
        this.lineStarts.push(i + 1);
      }
    }
  }

  positionAt(offset: number): TextPosition {
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStarts[mid] <= offset) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return { line: lo, character: offset - this.lineStarts[lo] };
  }

  rangeAt(start: number, end: number): TextRange {
    return { start: this.positionAt(start), end: this.positionAt(end) };
  }
}

/**
 * Masked source text has the same length and line structure as the original,
 * but comments and the *contents* of string/char/regex literals are replaced
 * by spaces. Delimiters (quotes) are kept. This lets simple regular
 * expressions and bracket matching work without being confused by code-like
 * text inside strings or comments.
 */
export function blank(text: string, start: number, end: number, out: string[]): void {
  for (let i = start; i < end; i++) {
    const ch = text[i];
    out[i] = ch === '\n' || ch === '\r' ? ch : ' ';
  }
}

/**
 * Given masked text and the offset of an opening bracket, returns the offset
 * of its matching closing bracket, or -1 if it is unbalanced.
 */
export function findMatchingBracket(masked: string, openOffset: number): number {
  const open = masked[openOffset];
  const close = open === '(' ? ')' : open === '[' ? ']' : open === '{' ? '}' : undefined;
  if (!close) {
    return -1;
  }
  let depth = 0;
  for (let i = openOffset; i < masked.length; i++) {
    const ch = masked[i];
    if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

export function skipWhitespace(masked: string, offset: number): number {
  while (offset < masked.length && /\s/.test(masked[offset])) {
    offset++;
  }
  return offset;
}

export function isIdentifierChar(ch: string | undefined): boolean {
  return !!ch && /[\p{L}\p{N}_$]/u.test(ch);
}
