/**
 * Slice-4 detector tests (#37): orphan-audio. Pure DB-vs-disk join over
 * injected rows/files — no hardware, no pyrekordbox, no fpcalc.
 */
import { describe, expect, test } from "bun:test";
import type { CheckCtx, DbContentRow, ShelfFile } from "../types";
import { orphanAudio } from "./orphan-audio";

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

describe("#37 slice 4: orphan-audio", () => {
  test("path + fp unknown → info finding; known path or fp → silent", () => {
    const rows = [
      row("Known", "/Volumes/SHELF1/M/Known.wav"),
      row("Moved", "/Volumes/SHELF1/OLD/Moved.wav"),
    ];
    const files = [
      file("/Volumes/SHELF1/M/Known.wav"), // path hit
      file("/Volumes/SHELF1/M/Moved.wav"), // path miss, fp hit (row title)
      file("/Volumes/SHELF1/M/BrandNew.wav"), // true orphan
    ];
    // fp by FILE PATH here, but collide the moved file with its row
    // ("Moved") to simulate "same content, different path":
    const c = ctx(rows, {
      fpFor: (p) => (p.endsWith("/Moved.wav") ? "fp:Moved" : `fp:${p}`),
      fpForRow: (r) => `fp:${r.title}`,
    });
    const out = orphanAudio.detect(files, c);
    expect(out.length).toBe(1);
    expect(out[0]!.kind).toBe("orphan-audio");
    expect(out[0]!.paths[0]).toBe("/Volumes/SHELF1/M/BrandNew.wav");
    expect(out[0]!.evidence).toMatchObject({ via: "path+fp" });
  });

  test("fp unavailable + path miss → still reports, flagged path-only", () => {
    const rows = [row("Known", "/Volumes/SHELF1/M/Known.wav")];
    const c = ctx(rows, { fpFor: () => null });
    const out = orphanAudio.detect([file("/Volumes/SHELF1/M/Mystery.wav")], c);
    expect(out.length).toBe(1);
    expect(out[0]!.evidence).toMatchObject({ via: "path-only" });
  });

  test("no DB seam → zero orphans (honest gap, never a false storm)", () => {
    const bare = { ...ctx([]), dbRows: undefined };
    expect(orphanAudio.detect([file("/x.wav")], bare)).toEqual([]);
  });
});
