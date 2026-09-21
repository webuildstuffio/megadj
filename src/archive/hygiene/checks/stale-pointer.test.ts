/**
 * Slice-4 detector tests (#37): stale-pointer. Pure DB-vs-disk join over
 * injected rows/files — no hardware, no pyrekordbox, no fpcalc.
 */
import { describe, expect, test } from "bun:test";
import type { CheckCtx, DbContentRow, ShelfFile } from "../types";
import { stalePointer } from "./stale-pointer";

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

describe("#37 slice 4: stale-pointer", () => {
  test("dead row + fp match elsewhere → finding with both paths", () => {
    const rows = [
      row("Eat Me Better", "/Volumes/SHELF1/OLD/Eat Me Better.wav"),
    ];
    const files = [file("/Volumes/SHELF1/NEW/Eat Me Better.wav")];
    // default fp hooks: file fp = fp:<pathkey> — collide them via opts
    const c = ctx(rows, {
      fpFor: () => "fp:same",
      fpForRow: () => "fp:same",
    });
    const out = stalePointer.detect(files, c);
    expect(out.length).toBe(1);
    expect(out[0]!.kind).toBe("stale-pointer");
    expect(out[0]!.paths[0]).toBe("/Volumes/SHELF1/NEW/Eat Me Better.wav");
    expect(out[0]!.evidence).toMatchObject({
      dbTitle: "Eat Me Better",
      foundAt: "/Volumes/SHELF1/NEW/Eat Me Better.wav",
      via: "fingerprint",
    });
  });

  test("row path alive → silent (that's not stale)", () => {
    const p = "/Volumes/SHELF1/M/Eat Me Better.wav";
    const c = ctx([row("Eat Me Better", p)], {
      fpFor: () => "fp:x",
      fpForRow: () => "fp:y",
    });
    expect(stalePointer.detect([file(p)], c)).toEqual([]);
  });

  test("row fp matches nothing on disk → silent (re-download's beat)", () => {
    const rows = [row("Eat Me Better", "/Volumes/SHELF1/OLD/Eat.wav")];
    const c = ctx(rows, { fpFor: () => "fp:disk", fpForRow: () => "fp:row" });
    expect(
      stalePointer.detect([file("/Volumes/SHELF1/M/Other.wav")], c),
    ).toEqual([]);
  });

  test("no dbRows / no fpOfRow seam → honest zero", () => {
    const bare = { ...ctx([]), dbRows: undefined, fpOfRow: undefined };
    expect(stalePointer.detect([file("/x.wav")], bare)).toEqual([]);
  });

  test("one proposal per matched file even with two dead rows same fp", () => {
    const rows = [
      row("A", "/Volumes/SHELF1/O1/A.wav"),
      row("B", "/Volumes/SHELF1/O2/B.wav"),
    ];
    const c = ctx(rows, { fpFor: () => "fp:same", fpForRow: () => "fp:same" });
    const out = stalePointer.detect([file("/Volumes/SHELF1/M/A.wav")], c);
    expect(out.length).toBe(1);
  });
});
