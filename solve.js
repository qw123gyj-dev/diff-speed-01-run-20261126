// A faster drop-in for makefun-diff 1.0.0.
//
// Same answer, byte for byte, on every input: the common prefix of lines is
// kept, then the common suffix of what is left; between them Myers's greedy
// search runs from the first lines, keeping on each diagonal the path that
// reaches furthest into the old text and, when a deletion and an insertion
// reach the same point, the deletion's, never moving past either text's end,
// pruning no edge diagonal, and following every run of equal lines as far as
// it goes; the first path to reach both ends is the script. The patch is
// written exactly as makefun-diff 1.0.0 writes it (see the header line, the
// hunk lines, the "=" / "-" / "+" lines, up to 3 kept lines of context, runs
// at most 6 kept lines apart sharing a hunk, "%" after a line with no
// trailing newline, and the first line alone for identical texts).
//
// Speed comes from doing the same search with integers instead of objects:
// every line is interned once to a small integer id (one shared table per
// case, so equality is one integer compare), the search keeps its furthest
// points in one flat typed array (the whole trace, so the winning path can
// be walked back), and the patch is built straight from the runs that walk
// produces. Nothing is cached from one case to the next; each run() call
// starts from a fresh table.

const KEEP = 0;
const DELETE = 1;
const INSERT = 2;

// A line that ends its text with no newline gets its id tagged with this bit.
// Only the last line of a text can lack its newline, and the tag keeps such a
// line unequal to the same characters with a newline, while two bare lines
// with the same characters stay equal. Ids stay far below this bit.
const BARE = 1 << 30;

// The trace stores x + 2, where x is the old position (the last old line
// consumed, -1 for none) after the snake; 0 means the diagonal was never
// reached. That leaves fresh arrays zero-filled, with no fill pass.

// Split a text into its lines, each as an integer id. The table is shared by
// the two texts of one case, so equal lines get equal ids in both.
function linesOf(text, table) {
  const parts = text.split('\n');
  const last = parts.length - 1;
  const bare = parts[last] !== '';
  const count = last + (bare ? 1 : 0);
  const ids = new Int32Array(count);
  for (let i = 0; i < last; i++) {
    const s = parts[i];
    let id = table.get(s);
    if (id === undefined) {
      id = table.size;
      table.set(s, id);
    }
    ids[i] = id;
  }
  if (bare) {
    const s = parts[last];
    let id = table.get(s);
    if (id === undefined) {
      id = table.size;
      table.set(s, id);
    }
    ids[last] = id | BARE;
  }
  return { ids, parts };
}

// The runs of the edit script of a into b: [{ kind, count }] in order, with
// kind KEEP / DELETE / INSERT. a and b are the interned id arrays of the two
// middle slices (prefix and suffix already trimmed by the caller).
//
// The trace is one flat array: level d lives at indices d*d .. d*d + 2d, so
// the whole trace through depth D takes (D+1)^2 entries and grows by
// doubling. A stored value is x + 2, where x is the old position (the last
// old line consumed, -1 for none) after the snake; 0 means the diagonal was
// never reached, which leaves fresh arrays zero-filled, with no fill pass.
// Walking the loop, the deletion parent of diagonal k is the insertion
// parent the previous step read, so it is carried in a variable instead of
// read twice; and only the diagonal k = n - m can reach both ends, so only
// it is checked for the end.
function editRuns(a, b) {
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return [];
  const maxD = n + m;
  const kEnd = n - m;
  let cap = 2048;
  let flat = new Int32Array(cap * cap);

  // Depth 0: the snake from before both texts' first lines.
  let x = -1;
  while (x + 1 < n && x + 1 < m && a[x + 1] === b[x + 1]) x++;
  flat[0] = x + 2;
  if (x + 1 >= n && x + 1 >= m) return x >= 0 ? [{ kind: KEEP, count: x + 1 }] : [];

  let D = -1;
  let kFin = 0;
  for (let d = 1; d <= maxD; d++) {
    if ((d + 1) * (d + 1) > flat.length) {
      let nc = cap;
      while ((d + 1) * (d + 1) > nc * nc) nc *= 2;
      const nf = new Int32Array(nc * nc);
      nf.set(flat);
      flat = nf;
      cap = nc;
    }
    const pbase = (d - 1) * (d - 1);
    const base = d * d;
    // Views over the two levels, so each access indexes from its own level
    // instead of adding the level's base every time.
    const prev = new Int32Array(flat.buffer, pbase * 4, 2 * d - 1);
    const cur = new Int32Array(flat.buffer, base * 4, 2 * d + 1);
    // The (d-1) value on diagonal k - 1, carried from the last step, where it
    // was the insertion parent; 0 on the first step, where there is none.
    let down = 0;
    let done = false;
    for (let k = -d, idx = 0; k <= d; k += 2, idx += 2) {
      // The two (d-1) paths this diagonal extends: the deletion's from k - 1
      // (carried) and the insertion's from k + 1. Stored values are x + 2,
      // 0 for none.
      const right = k < d ? prev[idx] : 0;
      // A deletion needs one more old line; an insertion one more new line.
      const canRemove = down !== 0 && down - 1 < n;
      const canAdd = right !== 0 && right - 2 - k < m;
      if (canRemove || canAdd) {
        // The candidate further into the old text wins; a tie goes to the
        // deletion. byDeletion is the old position after a deletion,
        // byInsertion the old position after an insertion (which leaves it
        // where it was).
        const byDeletion = canRemove ? down - 1 : -2;
        const byInsertion = canAdd ? right - 2 : -2;
        let xx = byDeletion >= byInsertion ? byDeletion : byInsertion;
        let y = xx - k;
        // Follow every run of lines equal in both as far as it goes.
        while (xx + 1 < n && y + 1 < m && a[xx + 1] === b[y + 1]) {
          xx++;
          y++;
        }
        cur[idx] = xx + 2;
        if (k === kEnd && xx === n - 1) {
          D = d;
          kFin = k;
          done = true;
          break;
        }
      }
      down = right;
    }
    if (done) break;
  }
  if (D < 0) throw new Error('makefun-diff: the search ended without reaching both ends');

  // Walk the winning path back: at each depth the same choice rule, run on
  // the stored depths, says which diagonal the path came from, and the
  // snake it ends with is the gap between the step's point and the stored
  // point, so no line is compared twice.
  const rev = [];
  let k = kFin;
  let d = D;
  x = n - 1;
  while (d > 0) {
    const pbase = (d - 1) * (d - 1);
    const down = k > -d ? flat[pbase + k + d - 2] : 0;
    const right = k < d ? flat[pbase + k + d] : 0;
    const canRemove = down !== 0 && down - 1 < n;
    const canAdd = right !== 0 && right - 2 - k < m;
    const byDeletion = canRemove ? down - 1 : -2;
    const byInsertion = canAdd ? right - 2 : -2;
    const del = byDeletion >= byInsertion;
    const xStep = del ? byDeletion : byInsertion;
    if (x > xStep) rev.push({ kind: KEEP, count: x - xStep });
    rev.push({ kind: del ? DELETE : INSERT, count: 1 });
    k = del ? k - 1 : k + 1;
    d--;
    x = flat[pbase + k + d] - 2;
  }
  if (x >= 0) rev.push({ kind: KEEP, count: x + 1 });

  // Reverse the walk and merge runs of one kind that touch.
  const runs = [];
  for (let i = rev.length - 1; i >= 0; i--) {
    const r = rev[i];
    const lastRun = runs[runs.length - 1];
    if (lastRun !== undefined && lastRun.kind === r.kind) lastRun.count += r.count;
    else runs.push({ kind: r.kind, count: r.count });
  }
  return runs;
}

// make.fun's own patch of input.old into input.new, as one string.
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('makefun-diff: the input is { old, new }, two strings');
  }
  const table = new Map();
  const oldText = linesOf(input.old, table);
  const newText = linesOf(input.new, table);
  const a = oldText.ids;
  const b = newText.ids;
  const n = a.length;
  const m = b.length;

  // The common prefix, then the common suffix of what is left.
  let prefix = 0;
  while (prefix < n && prefix < m && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && a[n - 1 - suffix] === b[m - 1 - suffix]) suffix++;

  const runs = [];
  if (prefix > 0) runs.push({ kind: KEEP, count: prefix });
  const mid = editRuns(a.subarray(prefix, n - suffix), b.subarray(prefix, m - suffix));
  for (const r of mid) {
    const lastRun = runs[runs.length - 1];
    if (lastRun !== undefined && lastRun.kind === r.kind) lastRun.count += r.count;
    else runs.push({ kind: r.kind, count: r.count });
  }
  if (suffix > 0) {
    const lastRun = runs[runs.length - 1];
    if (lastRun !== undefined && lastRun.kind === KEEP) lastRun.count += suffix;
    else runs.push({ kind: KEEP, count: suffix });
  }

  // The change runs: each a stretch of deletions and insertions between two
  // kept lines, at old line o and new line p.
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (const r of runs) {
    if (r.kind === KEEP) {
      o += r.count;
      p += r.count;
      continue;
    }
    let c = changes[changes.length - 1];
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (r.kind === DELETE) {
      c.dels += r.count;
      o += r.count;
      deleted += r.count;
    } else {
      c.ins += r.count;
      p += r.count;
      inserted += r.count;
    }
  }

  // The hunks: change runs at most 6 kept lines apart share one.
  const hunks = [];
  for (const c of changes) {
    const h = hunks[hunks.length - 1];
    const prev = h !== undefined ? h[h.length - 1] : undefined;
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 6) h.push(c);
    else hunks.push([c]);
  }

  const out = [`makefun-diff/1 old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  const oldParts = oldText.parts;
  const newParts = newText.parts;
  const oldLast = oldParts.length - 1;
  const newLast = newParts.length - 1;
  for (const h of hunks) {
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - 3);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(3, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (const c of h) {
      for (; at < c.o; at++) out.push('=' + oldParts[at] + (at < oldLast ? '\n' : '\n%\n'));
      for (let i = 0; i < c.dels; i++) {
        const j = c.o + i;
        out.push('-' + oldParts[j] + (j < oldLast ? '\n' : '\n%\n'));
      }
      for (let i = 0; i < c.ins; i++) {
        const j = c.p + i;
        out.push('+' + newParts[j] + (j < newLast ? '\n' : '\n%\n'));
      }
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) out.push('=' + oldParts[at] + (at < oldLast ? '\n' : '\n%\n'));
  }
  return out.join('');
}
