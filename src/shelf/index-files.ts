// index-files.ts — the shelf-side coverage index + per-file copy decision
// for `archive`, split out so the sweep loop reads as orchestration
// and each rule (exact match, variant twins, never-overwrite naming) is a
// named unit. All keys are NFC+casefold (the only honest comparison on
// exFAT). The directory traversal rides the shared walker (#69); this
// module adds the key/variant indexing policy.
import { existsSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { isSkippedName, key } from "./match";
import { walkTree } from "../shared/walk-tree";

/** One indexed shelf file. */
export interface ShelfEntry {
  /** Path relative to the shelf's Contents/. */
  rel: string;
  bytes: number;
}

/** Shelf coverage index. exact: (dirKey,nameKey) → entries — a drive file
 *  whose name matches one of these at the same size is covered. variant:
 *  a shelf file that is itself a preserved copy ("<stem> [<suffix>] <ext>")
 *  is also reachable by its ORIGINAL stem, so re-runs stay idempotent. */
export class ShelfIndex {
  readonly exact = new Map<string, ShelfEntry[]>();
  readonly variant = new Map<string, ShelfEntry[]>();
  private readonly contents: string;

  constructor(contentsDir: string) {
    this.contents = contentsDir;
    this.indexDir(contentsDir);
  }

  private push(map: Map<string, ShelfEntry[]>, k: string, v: ShelfEntry): void {
    const arr = map.get(k);
    if (arr) arr.push(v);
    else map.set(k, [v]);
  }

  private indexDir(dir: string): void {
    for (const e of walkTree(dir, { skip: (name) => isSkippedName(name) })
      .entries) {
      const rel = relative(this.contents, e.abs);
      const d = dirname(rel);
      const n = basename(rel);
      const bytes = e.bytes;
      this.push(this.exact, `${key(d)}/${key(n)}`, { rel, bytes });
      // "<stem> [<suffix>]<ext>" twins also answer to their original stem
      const m = n.match(/^(.*) \[([^\]]+)\](\.[^.]*)$/);
      if (m)
        this.push(
          this.variant,
          [key(d), key(m[1] ?? ""), key(m[3] ?? "")].join("/"),
          { rel, bytes },
        );
    }
  }

  /** Already-preserved variant twins of (dir, stem, ext), byte-matched. */
  hasVariant(dKey: string, stemKey: string, extKey: string, bytes: number) {
    return (this.variant.get([dKey, stemKey, extKey].join("/")) ?? []).some(
      (v) => v.bytes === bytes,
    );
  }

  /** Register a just-created variant so later same-family files in this
   *  run see it (multi-file sweeps, re-run idempotence within a run). */
  addVariant(
    dKey: string,
    stemKey: string,
    extKey: string,
    entry: ShelfEntry,
  ): void {
    this.push(this.variant, [dKey, stemKey, extKey].join("/"), entry);
  }
}

/** Pick the landing path for a copy. Rules, in order:
 *  1. --into trash-rescue: flat under Contents/<into>/, "-2" on collision.
 *  2. Drive file shadows a shelf file (`shadowed`, from the caller's exact
 *     match): preserved as `<stem> [<suffix>]<ext>` (then `[<suffix>-2]`,
 *     …) — NEVER overwrite; the shelf's rekordbox DB references its own
 *     files.
 *  3. Fresh file: keep its name/path. */
export function landingPath(
  contents: string,
  into: string | undefined,
  shadowed: boolean,
  relDir: string,
  name: string,
  suffix: string,
): string {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  if (into) {
    let dest = join(contents, into, name);
    let c = 2;
    while (existsSync(dest)) {
      dest = join(contents, into, `${stem}-${c}${ext}`);
      c++;
    }
    return dest;
  }
  if (shadowed) {
    let c = 1;
    let candidate = "";
    do {
      const tag = c === 1 ? ` [${suffix}]` : ` [${suffix}-${c}]`;
      candidate = join(contents, relDir, stem + tag + ext);
      c++;
    } while (existsSync(candidate) && c < 100);
    return candidate;
  }
  return join(contents, relDir, name);
}
