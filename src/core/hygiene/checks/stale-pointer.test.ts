/**
 * Slice-4 detector tests (#37): stale-pointer. Pure DB-vs-disk join over
 * injected rows/files — no hardware, no pyrekordbox, no fpcalc.
 */
import { describe, expect, test } from "bun:test";
import { stalePointer } from "./stale-pointer";
import { checkCtx, dbRow as row, shelfFile as file } from "./test-support/check-ctx-builder";

describe("#37 slice 4: stale-pointer", () => {
  test("dead row + fp match elsewhere → finding with both paths", () => {
    const rows = [row("Eat Me Better", "/Volumes/GREY FIKWOK/OLD/Eat Me Better.wav")];
    const files = [file("/Volumes/GREY FIKWOK/NEW/Eat Me Better.wav")];
    // default fp hooks: file fp = fp:<pathkey> — collide them via opts
    const c = checkCtx(rows, { fpFor: () => "fp:same", fpForRow: () => "fp:same" });
    const out = stalePointer.detect(files, c);
    expect(out.length).toBe(1);
    expect(out[0]!.kind).toBe("stale-pointer");
    expect(out[0]!.paths[0]).toBe("/Volumes/GREY FIKWOK/NEW/Eat Me Better.wav");
    expect(out[0]!.evidence).toMatchObject({
      dbTitle: "Eat Me Better",
      foundAt: "/Volumes/GREY FIKWOK/NEW/Eat Me Better.wav",
      via: "fingerprint",
    });
  });

  test("row path alive → silent (that's not stale)", () => {
    const p = "/Volumes/GREY FIKWOK/M/Eat Me Better.wav";
    const c = checkCtx([row("Eat Me Better", p)], { fpFor: () => "fp:x", fpForRow: () => "fp:y" });
    expect(stalePointer.detect([file(p)], c)).toEqual([]);
  });

  test("row fp matches nothing on disk → silent (re-download's beat)", () => {
    const rows = [row("Eat Me Better", "/Volumes/GREY FIKWOK/OLD/Eat.wav")];
    const c = checkCtx(rows, { fpFor: () => "fp:disk", fpForRow: () => "fp:row" });
    expect(stalePointer.detect([file("/Volumes/GREY FIKWOK/M/Other.wav")], c)).toEqual([]);
  });

  test("no dbRows / no fpOfRow seam → honest zero", () => {
    const bare = { ...checkCtx([]), dbRows: undefined, fpOfRow: undefined };
    expect(stalePointer.detect([file("/x.wav")], bare)).toEqual([]);
  });

  test("one proposal per matched file even with two dead rows same fp", () => {
    const rows = [
      row("A", "/Volumes/GREY FIKWOK/O1/A.wav"),
      row("B", "/Volumes/GREY FIKWOK/O2/B.wav"),
    ];
    const c = checkCtx(rows, { fpFor: () => "fp:same", fpForRow: () => "fp:same" });
    const out = stalePointer.detect([file("/Volumes/GREY FIKWOK/M/A.wav")], c);
    expect(out.length).toBe(1);
  });
});
