/**
 * Slice-4 detector tests (#37): re-download. Pure DB-vs-disk join over
 * injected rows/files — no hardware, no pyrekordbox, no fpcalc.
 */
import { describe, expect, test } from "bun:test";
import type { CheckCtx, DbContentRow, ShelfFile } from "../types";
import { reDownload } from "./re-download";

const WALK_TOKEN = "tok-slice4";
const NOW = () => "2026-09-21T00:00:00.000Z";

function ctx(
  rows: DbContentRow[],
  opts: {
    fpFor?: (path: string) => string | null;
    fpForRow?: (row: DbContentRow) => string | null;
  } = {},
): CheckCtx {
  const fpFor =
    opts.fpFor ?? ((p: string) => `fp:${p.normalize("NFC").toLowerCase()}`);
  const fpForRow = opts.fpForRow ?? ((r: DbContentRow) => `fp:${r.title}`);
  return {
    volume: "/Volumes/SHELF1",
    walkToken: WALK_TOKEN,
    md5: () => null,
    fp: (p) => fpFor(p),
    now: NOW,
    dbRows: () => rows,
    fpOfRow: (r) => fpForRow(r),
  };
}

function file(path: string, bytes = 100): ShelfFile {
  return { path, bytes, mtimeMs: 0 };
}

const row = (title: string, folderPath: string): DbContentRow => ({
  id: `1${Math.abs(title.length)}`,
  title,
  folderPath,
});

describe("#37 slice 4: re-download", () => {
  test("row gone from disk + fp unseen → re-download proposal with query", () => {
    const rows = [row("Eat Me Better", "/Volumes/SHELF1/OLD/Eat.wav")];
    const c = ctx(rows, { fpFor: () => "fp:disk", fpForRow: () => "fp:gone" });
    const out = reDownload.detect([file("/Volumes/SHELF1/M/Other.wav")], c);
    expect(out.length).toBe(1);
    expect(out[0]!.kind).toBe("re-download");
    expect(out[0]!.proposedAction).toEqual({
      type: "re-download",
      query: "Eat Me Better",
    });
  });

  test("fp match on disk → moved content, NOT re-download (stale-pointer's beat)", () => {
    const rows = [row("Moved", "/Volumes/SHELF1/OLD/Moved.wav")];
    const files = [file("/Volumes/SHELF1/M/Moved.wav")];
    const c = ctx(rows, { fpFor: () => "fp:same", fpForRow: () => "fp:same" });
    expect(reDownload.detect(files, c)).toEqual([]);
  });

  test("empty title → never fires (no filename-guess queries)", () => {
    const rows = { ...row("", "/Volumes/SHELF1/OLD/x.wav") };
    const c = ctx([rows], { fpFor: () => "fp:a", fpForRow: () => "fp:b" });
    expect(reDownload.detect([file("/M/y.wav")], c)).toEqual([]);
  });
});
