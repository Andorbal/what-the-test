import { blank } from '../text';

const REGEX_PRECEDING_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await',
]);

/**
 * Masks comments and literal contents in JavaScript/TypeScript source. The
 * code inside template literal substitutions (`${...}`) is kept, since test
 * bodies frequently contain templates with nested calls.
 */
export function maskJavaScript(text: string): string {
  const out = text.split('');
  const n = text.length;
  // Each entry is the brace depth at which a template substitution started.
  const templateStack: number[] = [];
  let braceDepth = 0;
  let i = 0;

  const previousSignificant = (from: number): { ch: string; word: string } => {
    let j = from - 1;
    while (j >= 0 && /\s/.test(out[j])) {
      j--;
    }
    if (j < 0) {
      return { ch: '', word: '' };
    }
    let k = j;
    while (k >= 0 && /[A-Za-z_$0-9]/.test(out[k])) {
      k--;
    }
    return { ch: out[j], word: out.slice(k + 1, j + 1).join('') };
  };

  /** Scans template text starting just after a backtick or `}`. */
  const scanTemplate = (start: number): number => {
    let j = start;
    while (j < n) {
      const ch = text[j];
      if (ch === '\\') {
        j += 2;
        continue;
      }
      if (ch === '`') {
        blank(text, start, j, out);
        return j + 1;
      }
      if (ch === '$' && text[j + 1] === '{') {
        blank(text, start, j, out);
        templateStack.push(braceDepth);
        braceDepth++;
        return j + 2;
      }
      j++;
    }
    blank(text, start, n, out);
    return n;
  };

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
    } else if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n && text[j] !== ch && text[j] !== '\n') {
        j += text[j] === '\\' ? 2 : 1;
      }
      blank(text, i + 1, Math.min(j, n), out);
      i = j + 1;
    } else if (ch === '`') {
      i = scanTemplate(i + 1);
    } else if (ch === '{') {
      braceDepth++;
      i++;
    } else if (ch === '}') {
      braceDepth--;
      if (templateStack.length && templateStack[templateStack.length - 1] === braceDepth) {
        templateStack.pop();
        i = scanTemplate(i + 1);
      } else {
        i++;
      }
    } else if (ch === '/') {
      const prev = previousSignificant(i);
      const startsRegex = prev.ch === '' || /[(,=:[!&|?{};+\-*%<>~^]/.test(prev.ch) || REGEX_PRECEDING_KEYWORDS.has(prev.word);
      if (!startsRegex) {
        i++;
        continue;
      }
      let j = i + 1;
      let inClass = false;
      while (j < n && text[j] !== '\n') {
        const c = text[j];
        if (c === '\\') {
          j += 2;
          continue;
        }
        if (c === '[') {
          inClass = true;
        } else if (c === ']') {
          inClass = false;
        } else if (c === '/' && !inClass) {
          break;
        }
        j++;
      }
      blank(text, i + 1, Math.min(j, n), out);
      i = j + 1;
    } else {
      i++;
    }
  }
  return out.join('');
}
