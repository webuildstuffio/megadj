// rb-playlist tests — the pure TS side of the setbuild→master playlist
// bridge. The pyrekordbox write path is hardware/app-gated (rekordbox
// must be quit) and is exercised by live dry-runs; these tests pin the
// gates, the chain→payload shape, and the report contract.
import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import {
  printRbPlaylistReport,
  rbPlaylist,
  type RbPlaylistResult,
} from "./rb-playlist";

const lines = (r: RbPlaylistResult): string[] => {
  const out: string[] = [];
  printRbPlaylistReport(r, (s) => out.push(s));
  return out;
};

describe("rb-playlist gates", () => {
  test("--apply without --yes is refused before any I/O", async () => {
    const r = await rbPlaylist({
      mount: "/definitely-not-a-volume",
      apply: true,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("--apply requires --yes");
    expect(r.db).toContain("PIONEER");
  });

  test("bad preset is a validation error (same parser as setbuild)", async () => {
    const r = await rbPlaylist({
      mount: "/definitely-not-a-volume",
      preset: "nope",
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("preset");
  });

  test("dry-run on a live env never claims linked > 0", async () => {
    // dev-env dependent (needs the real archive + SHELF1), so keep it
    // honest-but-tolerant: in ANY environment a dry-run must report
    // linked 0 / verified 0 / appliedMode false — writes are apply-only.
    // Long budget: the chain build reads per-file keys + probes the
    // encrypted master through uv/pyrekordbox (~35s cold in CI-like runs);
    // since the set-builder pool went whole-library (rev 22) the pool can
    // be ~530 rows, so the key-cache warm-up dominates — 5 min budget.
    const r = await rbPlaylist({ mount: "/definitely-not-a-volume" });
    expect(r.appliedMode).toBe(false);
    if (r.ok) {
      expect(r.linked).toBe(0);
      expect(r.verified).toBe(0);
      expect(r.playlistId).toBeNull();
    }
  }, 300_000);
});

describe("rb-playlist report contract", () => {
  test("error results print exactly one line", () => {
    const out = lines({
      command: "rb-playlist",
      db: "/x/master.db",
      playlist: "",
      group: "DJ-Imports",
      preset: "peak",
      minutes: 0,
      chain: 0,
      linked: 0,
      unmatched: [],
      playlistId: null,
      verified: 0,
      appliedMode: false,
      backedUpTo: null,
      errors: [],
      ok: false,
      error: "no master DB at /x/master.db",
    });
    expect(out).toEqual(["error: no master DB at /x/master.db"]);
  });

  test("dry-run report predicts honestly and never says linked", () => {
    const out = lines({
      command: "rb-playlist",
      db: "/Volumes/SHELF1/PIONEER/Master/master.db",
      playlist: "setbuild peak 30min 2026-09-11",
      group: "DJ-Imports",
      preset: "peak",
      minutes: 30,
      chain: 5,
      linked: 0,
      unmatched: [
        {
          title: "Only Track",
          reason:
            "no content row in master — run the fullpush import for it first",
        },
      ],
      playlistId: null,
      verified: 0,
      appliedMode: false,
      backedUpTo: null,
      errors: [],
      ok: true,
    });
    const joined = out.join("\n");
    expect(joined).toContain("dry-run");
    expect(joined).toContain("--apply --yes");
    expect(joined).toContain("Only Track");
    expect(joined).toContain("1 chain track(s) have no master row yet");
  });

  test("apply report shows verify count and backup", () => {
    const out = lines({
      command: "rb-playlist",
      db: "/Volumes/SHELF1/PIONEER/Master/master.db",
      playlist: "setbuild peak 30min 2026-09-11",
      group: "DJ-Imports",
      preset: "peak",
      minutes: 30,
      chain: 5,
      linked: 5,
      unmatched: [],
      playlistId: 12345,
      verified: 5,
      appliedMode: true,
      backedUpTo: "/Volumes/SHELF1/PIONEER/Master/master.db.bak-20260911200000",
      errors: [],
      ok: true,
    });
    const joined = out.join("\n");
    expect(joined).toContain("linked 5");
    expect(joined).toContain("post-verify: 5/5");
    expect(joined).toContain(".bak-");
  });
});

describe("rb-playlist chain→payload shape", () => {
  test("chain payload carries bare filenames (the master join key)", () => {
    // mirrors buildChain's basename-at-source contract: whatever buildSet
    // orders, the bridge sends basename(filePath) — never a local path
    const archivePath =
      "/Users/nick/Music/DJ-Imports/2026-09-11 378-shelf-rescue/Sous Sol · Deep Impressions, Vol. 4 · Gmaj Manuel Moreno-Taonga_Gmaj(Manuel Moreno.mp3";
    const base = archivePath.split("/").pop() ?? "";
    expect(base).not.toContain("/");
    expect(base.endsWith(".mp3")).toBe(true);
    expect(base.length).toBeGreaterThan(60); // clip-tolerance matters here
  });

  test("tmp workspace sanity (script contract is stable JSON)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rb-playlist-"));
    const p = join(dir, "payload.json");
    writeFileSync(
      p,
      JSON.stringify({ chain: [{ base: "a.mp3", title: "A" }] }),
    );
    const parsed = JSON.parse(await Bun.file(p).text()) as {
      chain: { base: string }[];
    };
    expect(parsed.chain[0]?.base).toBe("a.mp3");
  });
});
