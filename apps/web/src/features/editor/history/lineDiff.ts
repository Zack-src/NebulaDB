/**
 * A line diff in the shape a split view reads: rows with an old side and a new side. Lines that disappear
 * and lines that appear at the same place are paired as modifications, as a code review does.
 */

export interface DiffCell {
  /** 1-based line number on that side. */
  line: number;
  text: string;
  /** For a modification: the part of the line that differs, to be marked within it. */
  mark?: { from: number; to: number };
}

export type DiffRowKind = "same" | "added" | "removed" | "changed";

export interface DiffRow {
  kind: DiffRowKind;
  before?: DiffCell;
  after?: DiffCell;
}

/** A run of unchanged rows folded away in the "differences only" view. */
export interface DiffGap {
  kind: "gap";
  hidden: number;
}

export type DiffItem = DiffRow | DiffGap;

type Op = { type: "equal" | "delete" | "insert"; a?: number; b?: number };

/** Past this many differing lines the exact diff is not worth its memory: the block is shown replaced. */
const MAX_EDIT_DISTANCE = 3000;

/** Myers' O(ND) shortest edit script over the lines between the shared head and tail. */
function myers(a: string[], b: string[], aOffset: number, bOffset: number): Op[] {
  const n = a.length;
  const m = b.length;
  if (n === 0) return b.map((_, j): Op => ({ type: "insert", b: bOffset + j }));
  if (m === 0) return a.map((_, i): Op => ({ type: "delete", a: aOffset + i }));
  const max = Math.min(n + m, MAX_EDIT_DISTANCE);
  const v = new Int32Array(2 * max + 2);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[max + k - 1] < v[max + k + 1]) ? v[max + k + 1] : v[max + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[max + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  if (found < 0) {
    return [
      ...a.map((_, i): Op => ({ type: "delete", a: aOffset + i })),
      ...b.map((_, j): Op => ({ type: "insert", b: bOffset + j })),
    ];
  }
  const ops: Op[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const prev = trace[d];
    const k = x - y;
    const down = k === -d || (k !== d && prev[max + k - 1] < prev[max + k + 1]);
    const prevK = down ? k + 1 : k - 1;
    const prevX = prev[max + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      ops.push({ type: "equal", a: aOffset + x, b: bOffset + y });
    }
    if (down) ops.push({ type: "insert", b: bOffset + prevY });
    else ops.push({ type: "delete", a: aOffset + prevX });
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    x--;
    y--;
    ops.push({ type: "equal", a: aOffset + x, b: bOffset + y });
  }
  return ops.reverse();
}

function diffOps(before: string[], after: string[]): Op[] {
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head++;
  let tail = 0;
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail++;
  }
  const ops: Op[] = [];
  for (let i = 0; i < head; i++) ops.push({ type: "equal", a: i, b: i });
  ops.push(...myers(before.slice(head, before.length - tail), after.slice(head, after.length - tail), head, head));
  for (let i = 0; i < tail; i++) {
    ops.push({ type: "equal", a: before.length - tail + i, b: after.length - tail + i });
  }
  return ops;
}

/** The part of two lines that differs: what is left once the shared start and end are set aside. */
function innerMarks(before: string, after: string): { before: DiffCell["mark"]; after: DiffCell["mark"] } {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  ) {
    end++;
  }
  return {
    before: { from: start, to: before.length - end },
    after: { from: start, to: after.length - end },
  };
}

/** Two lines that are the same line edited, not two unrelated ones: most of the longer one is shared. */
function similar(a: string, b: string): boolean {
  if (a.trim() === b.trim()) return true;
  const longest = Math.max(a.length, b.length);
  if (Math.min(a.length, b.length) === 0) return false;
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  return start + end >= longest / 2;
}

/** How far ahead a line is looked for a partner when the next two do not match. */
const LOOKAHEAD = 8;

/** Every line of both texts as split-view rows, unchanged lines included. */
export function diffRows(beforeText: string, afterText: string): DiffRow[] {
  const before = beforeText.split("\n");
  const after = afterText.split("\n");
  const ops = diffOps(before, after);
  const rows: DiffRow[] = [];
  let i = 0;
  while (i < ops.length) {
    const op = ops[i];
    if (op.type === "equal") {
      rows.push({
        kind: "same",
        before: { line: op.a! + 1, text: before[op.a!] },
        after: { line: op.b! + 1, text: after[op.b!] },
      });
      i++;
      continue;
    }
    const removed: number[] = [];
    const added: number[] = [];
    while (i < ops.length && ops[i].type !== "equal") {
      if (ops[i].type === "delete") removed.push(ops[i].a!);
      else added.push(ops[i].b!);
      i++;
    }
    const pushRemoved = (index: number) =>
      rows.push({ kind: "removed", before: { line: removed[index] + 1, text: before[removed[index]] } });
    const pushAdded = (index: number) =>
      rows.push({ kind: "added", after: { line: added[index] + 1, text: after[added[index]] } });
    let r = 0;
    let a = 0;
    while (r < removed.length && a < added.length) {
      const oldLine = before[removed[r]];
      const newLine = after[added[a]];
      if (similar(oldLine, newLine)) {
        const marks = innerMarks(oldLine, newLine);
        rows.push({
          kind: "changed",
          before: { line: removed[r] + 1, text: oldLine, mark: marks.before },
          after: { line: added[a] + 1, text: newLine, mark: marks.after },
        });
        r++;
        a++;
        continue;
      }
      // Not the same line: skip to whichever side finds its partner first, else the old line is gone.
      let nextAdded = -1;
      for (let k = a + 1; k < Math.min(added.length, a + LOOKAHEAD) && nextAdded < 0; k++) {
        if (similar(oldLine, after[added[k]])) nextAdded = k;
      }
      let nextRemoved = -1;
      for (let k = r + 1; k < Math.min(removed.length, r + LOOKAHEAD) && nextRemoved < 0; k++) {
        if (similar(before[removed[k]], newLine)) nextRemoved = k;
      }
      if (nextAdded >= 0 && (nextRemoved < 0 || nextAdded - a <= nextRemoved - r)) {
        while (a < nextAdded) pushAdded(a++);
      } else if (nextRemoved >= 0) {
        while (r < nextRemoved) pushRemoved(r++);
      } else {
        pushRemoved(r++);
      }
    }
    while (r < removed.length) pushRemoved(r++);
    while (a < added.length) pushAdded(a++);
  }
  return rows;
}

/** Only the changed rows, each with `context` unchanged rows around it; the rest folded into gaps. */
export function foldUnchanged(rows: DiffRow[], context = 3): DiffItem[] {
  const keep = new Array<boolean>(rows.length).fill(false);
  rows.forEach((row, index) => {
    if (row.kind === "same") return;
    for (let k = Math.max(0, index - context); k <= Math.min(rows.length - 1, index + context); k++) keep[k] = true;
  });
  const items: DiffItem[] = [];
  let hidden = 0;
  rows.forEach((row, index) => {
    if (keep[index]) {
      if (hidden > 0) items.push({ kind: "gap", hidden });
      hidden = 0;
      items.push(row);
    } else hidden++;
  });
  if (hidden > 0) items.push({ kind: "gap", hidden });
  return items;
}
