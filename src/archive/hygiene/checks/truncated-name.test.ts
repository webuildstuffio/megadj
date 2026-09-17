import { describe, expect, test } from "bun:test";
import type { CheckCtx } from "../types";
import { truncatedName, type DbContentRow } from "./truncated-name";

function ctx(rows: DbContentRow[], over: Partial<CheckCtx> = {}): CheckCtx {
  return {
    volume: "/V",
    walkToken: "tok",
    md5: () => null,
    fp: () => null,
    now: () => "2026-09-17T00:00:00.000Z",
    ...(rows.length ? { dbRows: () => rows } : {}),
    ...over,
  };
}

function file(path: string, bytes: number) {
  return { path, bytes, mtimeMs: 0 };
}

describe("truncated-name (#9/#37 slice 3, prefix20 ladder)", () => {
  test("prefix20 match + dead DB path + strictly longer name proposes rename", () => {
    // the #9 shape: "faithless - not going home (eric prydz rem-3.wav"
    // vs DB row "Faithless - Not Going Home (Eric Prydz Remix).wav"
    const trunc =
      "/V/Contents/UnknownArtist/UnknownAlbum/faithless - not going home (eric prydz rem-3.wav";
    const rows: DbContentRow[] = [
      {
        id: "246369961",
        title: "Faithless - Not Going Home (Eric Prydz Remix)",
        folderPath:
          "/V/Contents/UnknownArtist/UnknownAlbum/Faithless - Not Going Home (Eric Prydz Remix).wav",
      },
    ];
    const res = truncatedName.detect([file(trunc, 95_402_554)], ctx(rows));
    expect(res.length).toBe(1);
    const f = res[0]!;
    expect(f.kind).toBe("truncated-name");
    expect(f.severity).toBe("review"); // human-gated, never auto-safe
    expect(f.autoSafe).toBe(false);
    expect(f.proposedAction).toEqual({
      type: "rename",
      to:
        "/V/Contents/UnknownArtist/UnknownAlbum/" +
        "Faithless - Not Going Home (Eric Prydz Remix).wav",
    });
    const ev = f.evidence as Record<string, unknown>;
    expect(ev.dbRowId).toBe("246369961");
    expect(ev.truncatedName).toBe(
      "faithless - not going home (eric prydz rem-3.wav",
    );
    expect(f.walkToken).toBe("tok"); // stale-apply abort key stamped
  });

  test("greece 2000 second twin fires the same way (#9's other group)", () => {
    const trunc =
      "/V/Contents/U/UA/three drives on a vinyl - greece 2000 (mel-1.wav";
    const rows: DbContentRow[] = [
      {
        id: "232831391",
        title:
          "Three Drives On A Vinyl - Greece 2000 (Melih Kor Extended Remix)",
        folderPath:
          "/V/Contents/U/UA/Three Drives On A Vinyl - Greece 2000 (Melih Kor Extended Remix).wav",
      },
    ];
    const res = truncatedName.detect([file(trunc, 89_295_512)], ctx(rows));
    expect(res.length).toBe(1);
    expect((res[0]!.evidence as Record<string, unknown>).dbRowId).toBe(
      "232831391",
    );
  });

  test("DB path still walked → not a candidate (rb-fix-paths owns dead rows, not us)", () => {
    const live = "/V/Contents/A/Greece 2000.wav";
    const rows: DbContentRow[] = [
      { id: "1", title: "Greece 2000", folderPath: live },
    ];
    const res = truncatedName.detect([file(live, 100)], ctx(rows));
    expect(res.length).toBe(0);
  });

  test("prefix20 mismatch → no proposal (different tracks in one dir)", () => {
    const trunc = "/V/Contents/A/completely different name.wav";
    const rows: DbContentRow[] = [
      {
        id: "1",
        title: "Greece 2000",
        folderPath: "/V/Contents/A/Greece 2000.wav",
      },
    ];
    const res = truncatedName.detect([file(trunc, 100)], ctx(rows));
    expect(res.length).toBe(0);
  });

  test("case/extension-only difference (row not strictly longer) never fires", () => {
    const disk = "/V/Contents/A/greece 2000.WAV";
    const rows: DbContentRow[] = [
      {
        id: "1",
        title: "Greece 2000",
        folderPath: "/V/Contents/A/Greece 2000.wav",
      },
    ];
    const res = truncatedName.detect([file(disk, 100)], ctx(rows));
    expect(res.length).toBe(0);
  });

  test("different directory → no candidate (rename stays same-dir)", () => {
    const trunc =
      "/V/Contents/B/faithless - not going home (eric prydz rem-3.wav";
    const rows: DbContentRow[] = [
      {
        id: "1",
        title: "Faithless - Not Going Home (Eric Prydz Remix)",
        folderPath:
          "/V/Contents/A/Faithless - Not Going Home (Eric Prydz Remix).wav",
      },
    ];
    const res = truncatedName.detect([file(trunc, 100)], ctx(rows));
    expect(res.length).toBe(0);
  });

  test("no dbRows in ctx → detects nothing (offline honest gap)", () => {
    const trunc =
      "/V/Contents/A/faithless - not going home (eric prydz rem-3.wav";
    const res = truncatedName.detect([file(trunc, 100)], ctx([]));
    expect(res.length).toBe(0);
  });
});
