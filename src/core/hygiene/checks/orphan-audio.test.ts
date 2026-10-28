/**
 * Slice-4 detector tests (#37): orphan-audio. Pure DB-vs-disk join over
 * injected rows/files — no hardware, no pyrekordbox, no fpcalc.
 */
import { describe, expect, test } from "bun:test";
import { orphanAudio } from "./orphan-audio";
import { checkCtx, dbRow as row, shelfFile as file } from "./test-support/check-ctx-builder";

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
    const c = checkCtx(rows, {
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
    const c = checkCtx(rows, { fpFor: () => null });
    const out = orphanAudio.detect([file("/Volumes/SHELF1/M/Mystery.wav")], c);
    expect(out.length).toBe(1);
    expect(out[0]!.evidence).toMatchObject({ via: "path-only" });
  });

  test("no DB seam → zero orphans (honest gap, never a false storm)", () => {
    const bare = { ...checkCtx([]), dbRows: undefined };
    expect(orphanAudio.detect([file("/x.wav")], bare)).toEqual([]);
  });
});
