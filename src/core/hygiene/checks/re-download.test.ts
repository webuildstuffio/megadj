/**
 * Slice-4 detector tests (#37): re-download. Pure DB-vs-disk join over
 * injected rows/files — no hardware, no pyrekordbox, no fpcalc.
 */
import { describe, expect, test } from "bun:test";
import { reDownload } from "./re-download";
import { checkCtx, dbRow as row, shelfFile as file } from "./test-support/check-ctx-builder";

describe("#37 slice 4: re-download", () => {
  test("row gone from disk + fp unseen → re-download proposal with query", () => {
    const rows = [row("Eat Me Better", "/Volumes/SHELF1/OLD/Eat.wav")];
    const c = checkCtx(rows, { fpFor: () => "fp:disk", fpForRow: () => "fp:gone" });
    const out = reDownload.detect([file("/Volumes/SHELF1/M/Other.wav")], c);
    expect(out.length).toBe(1);
    expect(out[0]!.kind).toBe("re-download");
    expect(out[0]!.proposedAction).toEqual({ type: "re-download", query: "Eat Me Better" });
  });

  test("fp match on disk → moved content, NOT re-download (stale-pointer's beat)", () => {
    const rows = [row("Moved", "/Volumes/SHELF1/OLD/Moved.wav")];
    const files = [file("/Volumes/SHELF1/M/Moved.wav")];
    const c = checkCtx(rows, { fpFor: () => "fp:same", fpForRow: () => "fp:same" });
    expect(reDownload.detect(files, c)).toEqual([]);
  });

  test("empty title → never fires (no filename-guess queries)", () => {
    const rows = { ...row("", "/Volumes/SHELF1/OLD/x.wav") };
    const c = checkCtx([rows], { fpFor: () => "fp:a", fpForRow: () => "fp:b" });
    expect(reDownload.detect([file("/M/y.wav")], c)).toEqual([]);
  });
});
