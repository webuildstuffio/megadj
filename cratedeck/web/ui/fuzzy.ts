// fuzzy.ts — fuse.js behind one tiny helper. Client-side filters were
// strict `toLowerCase().includes( + ` — typing "dustin" never found
// "Dustin Zahn", "ztahn" found nothing, and the deep crate search missed
// every typo. Fuse gives subsequence/transposition matching with scored,
// relevance-ordered hits; the index is built once per items reference
// (WeakMap cache — a snapshot's track rows are stable across keystrokes)
// and each search is then sub-millisecond.
//
// Deliberately NOT wired into DataTable: its `filter` story stays explicit
// (sites pass pre-filtered rows), so the table keeps its derived-grid
// guarantee and its API unchanged.
import Fuse, { type FuseIndex } from "fuse.js";

const THRESHOLD = 0.38; // 0 = exact … 1 = match anything. Typo-tolerant, not sloppy.
const cache = new WeakMap<object, FuseIndex<never>>();

/** Fuzzy-filter `items` against `q` over the given string keys. Empty query
 *  returns the input as-is (identity, not a copy — call sites can branch). */
export function fuzzyFilter<T extends object>(
  items: T[],
  q: string,
  keys: (keyof T & string)[],
  opts?: { limit?: number; threshold?: number },
): T[] {
  const query = q.trim();
  if (!query) return items;
  let index = cache.get(items) as FuseIndex<T> | undefined;
  if (!index) {
    index = Fuse.createIndex(keys as string[], items);
    cache.set(items, index as FuseIndex<never>);
  }
  const fuse = new Fuse(
    items,
    {
      keys: keys as string[],
      includeScore: false,
      threshold: opts?.threshold ?? THRESHOLD,
      ignoreLocation: true,
    },
    index,
  );
  const hits = opts?.limit
    ? fuse.search(query, { limit: opts.limit })
    : fuse.search(query);
  return hits.map((h) => h.item);
}

/** True when `text` fuzzy-matches the query as a standalone string — used
 *  for per-crate "did the name itself match" checks (drives the auto-open
 *  vs highlight distinction without building a one-item Fuse). */
export function fuzzyMatch(text: string, q: string): boolean {
  const query = q.trim().toLowerCase();
  if (!query) return false;
  if (text.toLowerCase().includes(query)) return true;
  // subsequence match (the f in fuzzy): every query char appears in order
  let at = 0;
  const hay = text.toLowerCase();
  for (const ch of query) {
    at = hay.indexOf(ch, at);
    if (at < 0) return false;
    at += 1;
  }
  return true;
}
