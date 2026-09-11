// shelf-archive-file.ts — the per-drive sweep for `shelf-archive`: classify
// every drive file against the shelf index (covered / preserved-twin /
// copy) and land the copies. Split from shelf-archive.ts so the command
// reads as orchestration (opts → sweeps ledger → JSON/human verdict) and
// the classification rules live here as named steps.
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  statSync,
  unlinkSync,
  utimesSync,
} from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { createHash } from "node:crypto";
import { ShelfIndex, landingPath } from "./shelf-index";
import { isJunk, isJunkDir, key } from "./shelf-match";

/** One real (non-junk) file found on a drive. */
export interface DriveFile {
  /** Absolute source path. */
  abs: string;
  /** Landing path relative to the shelf's Contents/. */
  rel: string;
  bytes: number;
}

/** Per-volume sweep outcome (one JSON `drives[]` row / one log line). */
export interface DriveResult {
  volume: string;
  mounted: boolean;
  /** Real (non-junk) files found on the drive. */
  files: number;
  /** Same shelf path + same size (byte-identical unless --deep said else). */
  coveredExact: number;
  /** Divergent version preserved as `<stem> [<suffix>] <ext>`. */
  preserved: number;
  copied: number;
  bytes: number;
  /** Copy/verify errors — the run's hard failures. */
  failed: number;
  /** Files that ended the run with no shelf coverage. */
  stillMissing: string[];
  ok: boolean;
}

/** MD5 in chunks (sync) — files can be 300 MB WAV sets; no full readFileSync. */
export function md5File(path: string): string {
  const h = createHash("md5");
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(1 << 20);
    let n = 0;
    while ((n = readSync(fd, buf, 0, buf.length, null)) > 0)
      h.update(buf.subarray(0, n));
  } finally {
    closeSync(fd);
  }
  return h.digest("hex");
}

/** Copy preserving mtime, then verify the bytes actually landed. */
function copyVerified(src: string, dest: string): void {
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  const st = statSync(src);
  if (statSync(dest).size !== st.size)
    throw new Error(`size mismatch after copy (${st.size} expected)`);
  if (md5File(src) !== md5File(dest))
    throw new Error("hash mismatch after copy");
  utimesSync(dest, st.atime, st.mtime);
}

/** Walk one source root; landing paths are relative to `landingRoot`. */
function walkRoot(
  srcRoot: string,
  landingRoot: string,
  out: DriveFile[],
): void {
  if (!existsSync(srcRoot)) return;
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || isJunk(entry.name)) continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (isJunkDir(entry.name)) continue;
        walk(abs);
      } else {
        out.push({
          abs,
          rel: relative(landingRoot, abs),
          bytes: statSync(abs).size,
        });
      }
    }
  };
  walk(srcRoot);
}

/** Every real file worth archiving on a drive. PIONEER/ (device DBs) is
 * deliberately NOT walked; PIONEER REC/ (user recordings) is. */
export function walkDrive(volume: string, trashes: boolean): DriveFile[] {
  const out: DriveFile[] = [];
  const contents = join(volume, "Contents");
  walkRoot(contents, contents, out); // Contents/<artist>/… → <artist>/…
  walkRoot(join(volume, "PIONEER REC"), volume, out); // PIONEER REC/x → x
  if (trashes) {
    const tr = join(volume, ".Trashes");
    if (existsSync(tr)) {
      // flat landing: trash files get Names, not paths (they came from
      // folders that mean nothing once deleted)
      const walkFlat = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.name.startsWith(".") || isJunk(entry.name)) continue;
          const abs = join(dir, entry.name);
          if (entry.isDirectory()) walkFlat(abs);
          else out.push({ abs, rel: entry.name, bytes: statSync(abs).size });
        }
      };
      walkFlat(tr);
    }
  }
  return out;
}

/** Classification verdict for one drive file. */
export type Verdict =
  | { kind: "covered" }
  | { kind: "preserved" }
  | { kind: "copy"; dest: string; asVariant: boolean };

/** Rule 1+2+3 for one file: covered by exact match (size-trusted unless
 *  `deep` MD5s the pair and says divergent), already preserved as a
 *  byte-matched twin under the suffix, or copy (never overwriting). */
export function classifyFile(
  shelf: ShelfIndex,
  f: DriveFile,
  o: {
    contents: string;
    into?: string | undefined;
    suffix: string;
    deep: boolean;
  },
): Verdict {
  const d = o.into ? "" : dirname(f.rel);
  const n = basename(f.rel);
  const dKey = key(d);
  const exactHits = shelf.exact.get(`${dKey}/${key(n)}`) ?? [];
  const sameSize = exactHits.filter((e) => e.bytes === f.bytes);

  // 1. Same path + same size = covered (byte-trusted unless --deep).
  if (sameSize.length > 0) {
    if (!o.deep) return { kind: "covered" };
    const diverged = sameSize.every(
      (e) => md5File(f.abs) !== md5File(join(o.contents, e.rel)),
    );
    if (!diverged) return { kind: "covered" };
  }

  // 2. A divergent version already preserved under this suffix? (Variant
  //    match is by ORIGINAL stem; size must agree so a genuinely different
  //    rip with a colliding stem still copies.)
  const dot = n.lastIndexOf(".");
  const stem = dot > 0 ? n.slice(0, dot) : n;
  const ext = dot > 0 ? n.slice(dot) : "";
  if (shelf.hasVariant(dKey, key(stem), key(ext), f.bytes))
    return { kind: "preserved" };

  // 3. Copy — shadowed files land as `<stem> [<suffix>]<ext>` twins.
  const shadowed = sameSize.length > 0 || exactHits.length > 0;
  return {
    kind: "copy",
    dest: landingPath(o.contents, o.into, shadowed, d, n, o.suffix),
    asVariant: !o.into && exactHits.length > 0,
  };
}

/** Sweep one drive volume against the shelf index. Freshly created
 *  variants register on the index so later same-family files in this run
 *  see them (multi-file sweeps, in-run re-run idempotence). */
export async function sweepVolume(
  volume: string,
  shelf: ShelfIndex,
  contents: string,
  opts: {
    into?: string | undefined;
    trashes: boolean;
    deep: boolean;
    dryRun: boolean;
    suffix: string;
  },
  log: (s: string) => void,
): Promise<DriveResult> {
  const res: DriveResult = {
    volume,
    mounted: existsSync(volume),
    files: 0,
    coveredExact: 0,
    preserved: 0,
    copied: 0,
    bytes: 0,
    failed: 0,
    stillMissing: [],
    ok: false,
  };
  if (!res.mounted) {
    res.stillMissing.push("(drive not mounted — nothing archived)");
    return res;
  }

  const files = walkDrive(volume, opts.trashes);
  res.files = files.length;

  for (const f of files) {
    const v = classifyFile(shelf, f, {
      contents,
      into: opts.into,
      suffix: opts.suffix,
      deep: opts.deep,
    });
    if (v.kind === "covered") {
      res.coveredExact++;
      continue;
    }
    if (v.kind === "preserved") {
      res.preserved++;
      continue;
    }

    res.copied++;
    res.bytes += f.bytes;
    if (v.asVariant) res.preserved++;
    if (opts.dryRun) continue;
    try {
      copyVerified(f.abs, v.dest);
      // remember the new variant for the rest of this run
      if (v.asVariant) {
        const n = basename(f.rel);
        const dot = n.lastIndexOf(".");
        const stem = dot > 0 ? n.slice(0, dot) : n;
        const ext = dot > 0 ? n.slice(dot) : "";
        shelf.addVariant(
          key(opts.into ? "" : dirname(f.rel)),
          key(stem),
          key(ext),
          {
            rel: relative(contents, v.dest),
            bytes: f.bytes,
          },
        );
      }
    } catch (e) {
      res.copied--;
      res.bytes -= f.bytes;
      if (v.asVariant) res.preserved--;
      res.failed++;
      res.stillMissing.push(f.rel);
      log(`failed: ${f.rel} (${e instanceof Error ? e.message : String(e)})`);
      try {
        if (existsSync(v.dest)) unlinkSync(v.dest); // never leave a corrupt "copy"
      } catch {
        // unlink failure leaves the partial file; stillMissing records it
      }
    }
  }

  res.ok = res.failed === 0;
  return res;
}
