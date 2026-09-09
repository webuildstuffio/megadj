/**
 * megadj shelf-archive — pull EVERYTHING from any number of drives into the
 * shelf master, additively, with a verified coverage verdict.
 *
 * The inverse of `shelf-sync` (archive → shelf): this is the intake sweep for
 * stray USBs/HDDs — "is anything on this drive missing from the archive, and
 * if so, move it over fully". Born from the Sep 9 2026 three-stick sweep
 * (BANGERS library + BOSEXY firmware stick + an empty stick), where the
 * hand-rolled loop hit every exFAT trap in the book. The command encodes
 * those traps so the sweep is one line next time:
 *
 * - AppleDouble (._*) / .DS_Store / fseventsd / Spotlight junk is excluded
 *   up front — on one real stick these were 1446 of 1449 apparent "missing"
 *   files. Never diff a Pioneer drive without this filter.
 * - Name comparison is NFC + casefold (exFAT is case-insensitive; "missing"
 *   files are often case variants — the usb-sync skill rule, applied here).
 * - Same size does NOT mean same content. Default classification trusts
 *   size (fast, resumable); --deep MD5s every same-size pair and preserves
 *   the divergent ones too (one 2019 stick had 291 of them — in-place tag
 *   rewrites and early bitrot both look like this).
 * - A shelf file is NEVER overwritten. When a drive's copy of a same-named
 *   track differs, the drive's version is preserved alongside as
 *   `<stem> [<drive>] <ext>` (suffix defaults to the volume name) — the
 *   shelf's rekordbox DB references its own files, and dedupe is a human
 *   decision made later, with both versions on disk.
 * - `PIONEER/` is never walked (live device DBs — machine-generated, and
 *   copying a stick's export.pdb anywhere near the shelf's DB tree is how
 *   libraries get destroyed). `PIONEER REC/` (user recordings) IS walked.
 * - `.Trashes` is skipped by default and included with --trashes — deleted
 *   mixes are exactly the kind of thing an archive exists to catch
 *   (--into names the landing folder, e.g. --into "DJ Sets & Mixes").
 * - Everything copied is MD5-verified after the copy; a partial or corrupt
 *   write fails the run (exit 1) instead of reading as coverage.
 *
 * Sources walked per volume: Contents/, PIONEER REC/, and (.Trashes when
 * --trashes). Every command takes --json (PRINCIPLES.md §1).
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readSync,
  openSync,
  closeSync,
  statSync,
  unlinkSync,
  utimesSync,
} from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { createHash } from "node:crypto";
import { ArchiveState } from "../state";

/** The archive DB (sweep ledger host). Env-overridable like cli.ts. */
const DB_PATH =
  process.env.MEGADJ_DB ?? `${process.env.HOME}/.local/state/megadj/archive.db`;

export interface ShelfArchiveOptions {
  /** Drive mount roots to archive FROM, e.g. /Volumes/BANGERS. */
  volumes: string[];
  /** Shelf master mount root (volume), e.g. /Volumes/SHELF1. */
  shelfVolume?: string;
  /** Land every copied file flat under Contents/<into>/ (trash rescue). */
  into?: string;
  /** Also walk <volume>/.Trashes — deleted files count as content. */
  trashes?: boolean;
  /** Bracket suffix for preserved divergent copies (default: volume name). */
  suffix?: string;
  /** MD5 every same-size pair; preserve divergent ones like size diffs. */
  deep?: boolean;
  dryRun?: boolean;
  json?: boolean;
  log?: (s: string) => void;
  /** Sweep-ledger override (tests pass a temp DB; default = the archive DB).
   *  Pass `null` to disable recording entirely. */
  ledgerPath?: string | null;
}

interface DriveFile {
  /** Absolute source path. */
  abs: string;
  /** Landing path relative to the shelf's Contents/. */
  rel: string;
  bytes: number;
}

interface DriveResult {
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
function md5Sync(path: string): string {
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

/** Junk that must never count as content (the AppleDouble trap). */
function isJunk(name: string): boolean {
  return (
    name.startsWith("._") ||
    name === ".DS_Store" ||
    name === "System Volume Information" ||
    name === "$RECYCLE.BIN" ||
    name === "XDJXZ.UPD" // device firmware blob, not music
  );
}

/** Machine-generated dirs whose contents are cache/DB, never user music. */
function isJunkDir(name: string): boolean {
  return name === "USBANLZ" || name === "ARTWORK";
}

/** NFC + casefold key — the only honest name comparison on exFAT. */
function key(s: string): string {
  return s.normalize("NFC").toLowerCase();
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
function walkDrive(volume: string, trashes: boolean): DriveFile[] {
  const out: DriveFile[] = [];
  const contents = join(volume, "Contents");
  walkRoot(contents, contents, out); // Contents/<artist>/… → <artist>/…
  walkRoot(join(volume, "PIONEER REC"), volume, out); // PIONEER REC/x → x
  if (trashes) {
    const tr = join(volume, ".Trashes");
    if (existsSync(tr)) {
      // flat landing: trash files get Names, not paths (they came from folders
      // that mean nothing once deleted)
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

/** Copy preserving mtime, then verify the bytes actually landed. */
function copyVerified(src: string, dest: string): void {
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  const st = statSync(src);
  if (statSync(dest).size !== st.size)
    throw new Error(`size mismatch after copy (${st.size} expected)`);
  if (md5Sync(src) !== md5Sync(dest))
    throw new Error("hash mismatch after copy");
  utimesSync(dest, st.atime, st.mtime);
}

export async function shelfArchive(opts: ShelfArchiveOptions): Promise<void> {
  const {
    volumes,
    shelfVolume = "/Volumes/SHELF1",
    into,
    trashes = false,
    deep = false,
    dryRun = false,
    json = false,
    log = (s) => console.log(s),
    ledgerPath = DB_PATH,
  } = opts;

  // Every sweep is recorded in the archive DB (megadj.state), preview or
  // full — the "when did drive X last get archived, and what happened" is
  // DB state, not markdown memory. The DB lives on this Mac, so a missing
  // file is recorded as note, never a crash (the sweep itself is I/O work).
  let sweeps: import("../shelf_sweeps").ShelfSweeps | null = null;
  let state: ArchiveState | null = null;
  if (ledgerPath !== null) {
    try {
      state = new ArchiveState(ledgerPath);
      sweeps = state.shelfSweeps;
    } catch (e) {
      log(
        `shelf-archive: (sweep ledger unavailable: ${e instanceof Error ? e.message : e})`,
      );
    }
  }

  const contents = join(shelfVolume, "Contents");
  const shelfMounted = existsSync(contents);
  const results: DriveResult[] = [];

  if (!shelfMounted) {
    const msg = `shelf not mounted (no ${contents})`;
    if (json)
      console.log(
        JSON.stringify({ command: "shelf-archive", error: msg, ok: false }),
      );
    else log(`shelf-archive: ${msg}`);
    process.exitCode = 1;
    return;
  }

  // Shelf index. exact: (dirKey,nameKey) → entries — a drive file whose name
  // matches one of these at the same size is covered. variant: a shelf file
  // that is itself a preserved copy ("<stem> [<suffix>] <ext>") is also
  // reachable by its ORIGINAL stem, so re-runs stay idempotent.
  const shelfExact = new Map<string, { rel: string; bytes: number }[]>();
  const shelfVariant = new Map<string, { rel: string; bytes: number }[]>();
  const push = (
    map: Map<string, { rel: string; bytes: number }[]>,
    k: string,
    v: { rel: string; bytes: number },
  ) => {
    const arr = map.get(k);
    if (arr) arr.push(v);
    else map.set(k, [v]);
  };
  const indexShelf = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || isJunk(entry.name)) continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        indexShelf(abs);
        continue;
      }
      const rel = relative(contents, abs);
      const d = dirname(rel);
      const n = basename(rel);
      const bytes = statSync(abs).size;
      push(shelfExact, `${key(d)}/${key(n)}`, { rel, bytes });
      const m = n.match(/^(.*) \[([^\]]+)\](\.[^.]*)$/);
      if (m)
        push(
          shelfVariant,
          [key(d), key(m[1] ?? ""), key(m[3] ?? "")].join("/"),
          { rel, bytes },
        );
    }
  };
  indexShelf(contents);

  for (const volume of volumes) {
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
    results.push(res);
    if (!res.mounted) {
      res.stillMissing.push("(drive not mounted — nothing archived)");
      continue;
    }

    const sweepId = sweeps
      ? sweeps.start({
          drive: basename(volume),
          shelf: basename(shelfVolume),
          deep,
          trashes,
          into: into ?? null,
        })
      : null;

    const files = walkDrive(volume, trashes);
    res.files = files.length;
    const suffix = (opts.suffix ?? basename(volume)).replace(/[/\\]/g, "-");

    for (const f of files) {
      const d = into ? "" : dirname(f.rel);
      const n = basename(f.rel);
      const dot = n.lastIndexOf(".");
      const stem = dot > 0 ? n.slice(0, dot) : n;
      const ext = dot > 0 ? n.slice(dot) : "";
      const exactHits = shelfExact.get(`${key(d)}/${key(n)}`) ?? [];

      // 1. Same path + same size = covered (byte-trusted unless --deep).
      const sameSize = exactHits.filter((e) => e.bytes === f.bytes);
      if (sameSize.length > 0) {
        if (deep) {
          const diverged = sameSize.every(
            (e) => md5Sync(f.abs) !== md5Sync(join(contents, e.rel)),
          );
          if (!diverged) {
            res.coveredExact++;
            continue;
          }
        } else {
          res.coveredExact++;
          continue;
        }
      }

      // 2. A divergent version already preserved under this suffix?
      //    (Variant match is by ORIGINAL stem; size must agree so a
      //    genuinely different rip with a colliding stem still copies.)
      const vk = [key(d), key(stem), key(ext)].join("/");
      if ((shelfVariant.get(vk) ?? []).some((v) => v.bytes === f.bytes)) {
        res.preserved++;
        continue;
      }

      // 3. Copy — never overwrite. Divergent same-name content lands as
      //    <stem> [<suffix>]<ext> next to the shelf original; fresh files
      //    (or --into flat landings) keep their name.
      let dest: string;
      if (into) {
        dest = join(contents, into, n);
        let c = 2;
        while (existsSync(dest))
          ((dest = join(contents, into, `${stem}-${c}${ext}`)), c++);
      } else if (sameSize.length > 0 || exactHits.length > 0) {
        let c = 1;
        let candidate = "";
        do {
          const tag = c === 1 ? ` [${suffix}]` : ` [${suffix}-${c}]`;
          candidate = join(contents, d, stem + tag + ext);
          c++;
        } while (existsSync(candidate) && c < 100);
        dest = candidate;
      } else {
        dest = join(contents, d, n);
      }

      res.copied++;
      res.bytes += f.bytes;
      if (!into && exactHits.length > 0) res.preserved++;
      if (dryRun) continue;
      try {
        copyVerified(f.abs, dest);
        // remember the new variant for the rest of this run (multi-file
        // sweeps of the same name family, re-run idempotence within a run)
        if (!into && exactHits.length > 0)
          push(shelfVariant, [key(d), key(stem), key(ext)].join("/"), {
            rel: relative(contents, dest),
            bytes: f.bytes,
          });
      } catch (e) {
        res.copied--;
        res.bytes -= f.bytes;
        if (!into && exactHits.length > 0) res.preserved--;
        res.failed++;
        res.stillMissing.push(f.rel);
        log(`failed: ${f.rel} (${e instanceof Error ? e.message : String(e)})`);
        try {
          if (existsSync(dest)) unlinkSync(dest); // never leave a corrupt "copy"
        } catch {
          // unlink failure leaves the partial file; stillMissing records it
        }
      }
    }

    res.ok = res.failed === 0;
    if (sweeps && sweepId !== null) {
      const counts = {
        filesSeen: res.files,
        coveredExact: res.coveredExact,
        preserved: res.preserved,
        copied: res.copied,
        bytesCopied: res.bytes,
        failed: res.failed,
      };
      if (dryRun) sweeps.finishPreview(sweepId, counts);
      else
        sweeps.finish(
          sweepId,
          counts,
          res.ok
            ? undefined
            : res.stillMissing.slice(0, 5).join("; ").slice(0, 500),
        );
    }
  }

  const allOk = results.every((r) => (r.mounted ? r.ok : true));
  state?.close(); // flush + release the ledger DB before any exit path
  if (json) {
    console.log(
      JSON.stringify(
        {
          command: "shelf-archive",
          shelf: shelfVolume,
          into: into ?? null,
          trashes,
          deep,
          dry_run: dryRun,
          drives: results,
          ok: allOk,
        },
        null,
        2,
      ),
    );
    if (!allOk) process.exitCode = 1;
    return;
  }

  log(
    `shelf-archive → ${shelfVolume}${dryRun ? " (dry run)" : ""}${deep ? " [deep]" : ""}${trashes ? " [trashes]" : ""}`,
  );
  for (const r of results) {
    if (!r.mounted) {
      log(`  ${r.volume}: not mounted — skipped`);
      continue;
    }
    log(
      `  ${r.volume}: ${r.files} files — ${r.coveredExact} already archived, ${dryRun ? "would copy" : "copied"} ${r.copied} (${(r.bytes / 1e9).toFixed(2)} GB)${r.preserved ? `, ${r.preserved} preserved as variants` : ""}${r.failed ? `, FAILED ${r.failed}` : ""}`,
    );
    for (const m of r.stillMissing.slice(0, 10)) log(`    ! ${m}`);
  }
  if (!allOk) {
    log("shelf-archive: NOT fully covered — see failures above");
    process.exitCode = 1;
  } else {
    log("shelf-archive: ✅ every drive file is covered on the shelf");
  }
}
