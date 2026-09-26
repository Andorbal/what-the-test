import { blank } from '../text';

/**
 * Masks comments and the contents of string, raw string and rune literals in
 * Go source, keeping the quotes.
 */
export function maskGo(text: string): string {
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
    } else if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      const j = end === -1 ? n : end + 2;
      blank(text, i, j, out);
      i = j;
    } else if (ch === '`') {
      const end = text.indexOf('`', i + 1);
      const j = end === -1 ? n : end;
      blank(text, i + 1, j, out);
      i = j + 1;
    } else if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n && text[j] !== ch && text[j] !== '\n') {
        j += text[j] === '\\' ? 2 : 1;
      }
      blank(text, i + 1, Math.min(j, n), out);
      i = j + 1;
    } else {
      i++;
    }
  }
  return out.join('');
}
