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

import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { ArchiveState } from "../archive/state";
import { ShelfIndex } from "./shelf-index";
import { sweepVolume, type DriveResult } from "./shelf-archive-file";
import { resolveShelfVolume } from "../shared/volume";

/** The archive DB (sweep ledger host). Env-overridable like cli.ts. */
const DB_PATH =
  process.env.MEGADJ_DB ?? `${process.env.HOME}/.local/state/megadj/archive.db`;

export interface ShelfArchiveOptions {
  /** Drive mount roots to archive FROM, e.g. /Volumes/BANGERS. */
  volumes: string[];
  /** Shelf master mount root (volume), e.g. /Volumes/SHELF1. */
  shelfVolume?: string | undefined;
  /** Land every copied file flat under Contents/<into>/ (trash rescue). */
  into?: string | undefined;
  /** Also walk <volume>/.Trashes — deleted files count as content. */
  trashes?: boolean | undefined;
  /** Bracket suffix for preserved divergent copies (default: volume name). */
  suffix?: string | undefined;
  /** MD5 every same-size pair; preserve divergent ones like size diffs. */
  deep?: boolean | undefined;
  dryRun?: boolean | undefined;
  json?: boolean | undefined;
  log?: ((s: string) => void) | undefined;
  /** Sweep-ledger override (tests pass a temp DB; default = the archive DB).
   *  Pass `null` to disable recording entirely. */
  ledgerPath?: string | null | undefined;
}

export async function shelfArchive(opts: ShelfArchiveOptions): Promise<void> {
  const {
    volumes,
    shelfVolume = resolveShelfVolume(),
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
  let sweeps: import("../archive/sweeps").ShelfSweeps | null = null;
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

  // Shelf index (exact + variant twins) — built and maintained by
  // ShelfIndex (shelf-index.ts); just-created variants register as they
  // land so multi-file sweeps and in-run re-runs stay idempotent.
  const shelf = new ShelfIndex(contents);

  for (const volume of volumes) {
    const sweepId = sweeps
      ? sweeps.start({
          drive: basename(volume),
          shelf: basename(shelfVolume),
          deep,
          trashes,
          into: into ?? null,
        })
      : null;

    const suffix = (opts.suffix ?? basename(volume)).replace(/[/\\]/g, "-");
    const res = await sweepVolume(
      volume,
      shelf,
      contents,
      {
        into: into === undefined ? undefined : into,
        trashes,
        deep,
        dryRun,
        suffix,
      },
      log,
    );
    results.push(res);

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
