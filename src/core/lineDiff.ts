/**
 * Line-based diff used to find the lines of a file that changed. Nothing in
 * this file may import `vscode`, so it can be unit tested with plain Node.
 */

/** Beyond this many edits, every line between the common prefix and suffix is treated as changed. */
const MAX_EDITS = 2000;

/**
 * Zero-based lines of `newText` that were added or modified relative to
 * `oldText`, in ascending order. Where lines were only deleted, the lines on
 * either side of the deletion count as changed, since the code around them
 * did. Line endings are ignored, so CRLF and LF versions of a file are equal.
 */
export function changedLines(oldText: string, newText: string): number[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    start++;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const changed = new Set<number>();
  /** Lines of `b` that follow deleted lines. */
  const deletions: number[] = [];
  const complete = diff(a.slice(start, endA), b.slice(start, endB), line => changed.add(start + line), line => deletions.push(start + line));
  if (!complete) {
    for (let line = start; line < endB; line++) {
      changed.add(line);
    }
    deletions.push(start);
  }
  for (const at of deletions) {
    // Lines that replace the deleted ones are already marked; otherwise mark both neighbours.
    if (changed.has(at) || changed.has(at - 1)) {
      continue;
    }
    for (const line of [at - 1, at]) {
      if (line >= 0 && line < b.length) {
        changed.add(line);
      }
    }
  }
  return [...changed].sort((x, y) => x - y);
}

function splitLines(text: string): string[] {
  return text === '' ? [] : text.split(/\r?\n/);
}

/**
 * Myers' O(ND) diff. Calls `onInsert` with the index in `b` of every inserted
 * line and `onDelete` with the index in `b` that follows every deleted line.
 * Returns false (without calling either) if there are more than
 * {@link MAX_EDITS} edits.
 */
function diff(a: readonly string[], b: readonly string[], onInsert: (bIndex: number) => void, onDelete: (bIndex: number) => void): boolean {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) {
    for (let i = 0; i < m; i++) {
      onInsert(i);
    }
    if (n > 0) {
      onDelete(0);
    }
    return true;
  }

  const max = Math.min(n + m, MAX_EDITS);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  // trace[d] holds diagonals -d..d of `v` as it was before step d.
  const trace: Int32Array[] = [];
  let edits = -1;
  for (let d = 0; d <= max && edits === -1; d++) {
    trace.push(v.slice(offset - d, offset + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
        ? v[offset + k + 1]
        : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        edits = d;
        break;
      }
    }
  }
  if (edits === -1) {
    return false;
  }

  let x = n;
  let y = m;
  for (let d = edits; d > 0; d--) {
    const previous = trace[d];
    const at = (k: number) => previous[k + d];
    const k = x - y;
    const inserted = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const prevK = inserted ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    if (inserted) {
      onInsert(prevY);
    } else {
      onDelete(prevY);
    }
    x = prevX;
    y = prevY;
  }
  return true;
}
