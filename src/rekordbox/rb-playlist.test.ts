// rb-playlist tests — the pure TS side of the setbuild→master playlist
// bridge. The pyrekordbox write path is hardware/app-gated (rekordbox
// must be quit) and is exercised by live dry-runs; these tests pin the
// gates, the chain→payload shape, and the report contract.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { writeFileSync, readFileSync } from "node:fs";
import {
  printRbPlaylistReport,
  rbPlaylist,
  __test,
  type RbPlaylistResult,
} from "./rb-playlist";
import { renderKitMarkers } from "./rb-command-kit";
import { tempDir } from "../test-support/testutil";

const scriptsSource = readFileSync(
  join(import.meta.dir, "rb-playlist-scripts.ts"),
  "utf8",
);

/** The RENDERED write/predict programs — kit markers resolved exactly as
 *  rbPythonFile does at spawn time (#194 corpus extraction). */
const writeScriptSource = readFileSync(
  join(import.meta.dir, "rb-scripts", "playlist-write.kit.py"),
  "utf8",
);
const predictScriptSource = readFileSync(
  join(import.meta.dir, "rb-scripts", "playlist-predict.kit.py"),
  "utf8",
);

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

  test("a missing master is rejected before the live archive is scanned", async () => {
    // Regression: this nonexistent target used to build a whole-library
    // chain first, spawning ffprobe once per archive file and stalling the
    // full gate for minutes before returning the inevitable missing-DB error.
    const started = performance.now();
    const r = await rbPlaylist({ mount: "/definitely-not-a-volume" });
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(r.appliedMode).toBe(false);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("no master DB");
    expect(r.linked).toBe(0);
    expect(r.verified).toBe(0);
    expect(r.playlistId).toBeNull();
  });
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
      cueWindows: [],
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
      cueWindows: [
        { title: "Cued Track", mixIn: "45s @ bar 25", mixOut: "107s @ bar 57" },
        { title: "Only Track", mixIn: null, mixOut: null },
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
      playlistId: "12345",
      verified: 5,
      appliedMode: true,
      backedUpTo: "/Volumes/SHELF1/PIONEER/Master/master.db.bak-20260911200000",
      errors: [],
      cueWindows: [],
      ok: true,
    });
    const joined = out.join("\n");
    expect(joined).toContain("linked 5");
    expect(joined).toContain("post-verify: 5/5");
    expect(joined).toContain(".bak-");
  });

  test("#106 Phase D: dry-run report renders per-step handoff windows", () => {
    const out = lines({
      command: "rb-playlist",
      db: "/Volumes/SHELF1/PIONEER/Master/master.db",
      playlist: "setbuild warmup 30min 2026-09-16",
      group: "DJ-Imports",
      preset: "warmup",
      minutes: 30,
      chain: 2,
      linked: 0,
      unmatched: [],
      cueWindows: [
        {
          title: "Cued Opener",
          mixIn: "45s @ bar 25",
          mixOut: "107s @ bar 57",
        },
        { title: "Cueless Track", mixIn: null, mixOut: null },
      ],
      playlistId: null,
      verified: 0,
      appliedMode: false,
      backedUpTo: null,
      errors: [],
      ok: true,
    });
    const joined = out.join("\n");
    // cue evidence appears per step, with the cueless track honestly null
    expect(joined).toContain("Cued Opener");
    expect(joined).toContain("mix-in 45s @ bar 25 · mix-out 107s @ bar 57");
    expect(joined).toContain("Cueless Track");
    expect(joined).toContain("no cue windows (no cues ledger row)");
  });
});

describe("rb-playlist subprocess boundaries", () => {
  test("write output preserves a 64-bit playlist id as decimal text", () => {
    const id = "9007199254740993";
    expect(
      __test.parseWriteOutput(
        JSON.stringify({
          linked: 1,
          unmatched: [],
          playlistId: id,
          parentId: "9007199254740995",
          errors: [],
        }),
      ).playlistId,
    ).toBe(id);
    expect(renderKitMarkers(writeScriptSource)).toContain(
      'out["playlistId"] = str(pl.ID)',
    );
    expect(writeScriptSource).toContain("from pyrekordbox.db6.tables import");
    expect(writeScriptSource).toContain("DjmdSongPlaylist");
    // #88 item 2: builders/parsers live in rb-playlist-scripts.ts; #194:
    // the PROGRAMS live in rb-scripts/*.py (this module spawns them via
    // rbPythonFile — no template-string python is left here).
    expect(scriptsSource).not.toContain("export function buildScript");
    expect(scriptsSource).toContain("export function parseWriteOutput");
    expect(scriptsSource).not.toContain("export function buildMegaset");
  });

  test("write, verify, and prediction parsers reject empty schemas", () => {
    expect(() => __test.parseWriteOutput("{}")).toThrow("invalid result");
    expect(() => __test.parseVerifyOutput("{}")).toThrow("invalid result");
    expect(() => __test.parseMatchPrediction("{}")).toThrow("invalid result");
  });

  test("a failed or malformed dry-run probe is a hard error", () => {
    expect(() =>
      __test.parsePredictionProcess({
        status: 2,
        stdout: "",
        stderr: "cannot open master",
      }),
    ).toThrow("match probe failed");
    expect(() =>
      __test.parsePredictionProcess({
        status: 0,
        stdout: "{}",
        stderr: "",
      }),
    ).toThrow("invalid result");
  });

  test("verify counters and contiguity are strongly typed", () => {
    expect(__test.parseVerifyOutput('{"rows":2,"contiguous":true}')).toEqual({
      rows: 2,
      contiguous: true,
    });
    expect(() =>
      __test.parseVerifyOutput('{"rows":"2","contiguous":true}'),
    ).toThrow();
  });

  test("the requested group is matched at the root only, via the kit ladder", () => {
    const script = renderKitMarkers(writeScriptSource);
    expect(script).toContain("def find_playlist(name, attr, parent_id):");
    expect(script).toContain("DjmdPlaylist.ParentID == parent_id");
    expect(script).toContain("find_playlist(group_name, 1, 0)");
    expect(script).toContain("find_playlist(playlist_name, 0, parent.ID)");
    // the ensure ladder comes from rb-script-kit: ONE DjmdPlaylist field
    // set + ONE duplicate-name refusal, interpolated (the hand twin is
    // gone — a field change is a kit edit, not two script edits)
    expect(script).toContain('out["parentId"] = str(parent.ID)');
    expect(script).toContain("already exists in");
    expect(script.match(/DjmdPlaylist\(ID=rid\(\)/gu)?.length).toBe(2);
  });
});

describe("rb-playlist chain→payload shape", () => {
  test("chain payload carries case-folded exact paths plus the basename fallback", () => {
    const archivePath =
      "/Users/nick/Music/DJ-Imports/2026-09-11 378-shelf-rescue/Sous Sol · Deep Impressions, Vol. 4 · Gmaj Manuel Moreno-Taonga_Gmaj(Manuel Moreno.mp3";
    const base = archivePath.split("/").pop() ?? "";
    expect(base).not.toContain("/");
    expect(base.endsWith(".mp3")).toBe(true);
    expect(base.length).toBeGreaterThan(60); // clip-tolerance matters here
    const script = renderKitMarkers(writeScriptSource);
    const prediction = renderKitMarkers(predictScriptSource);
    expect(script).toContain('path = path_key(track["path"])');
    expect(script).toContain("return nfc(s).casefold()");
    expect(script).toContain(
      "expected_parent_id = parent.ID if parent is not None else 0",
    );
    expect(script).toContain("str(p.ParentID or 0) == str(expected_parent_id)");
    expect(prediction).toContain("return nfc(s).casefold()");
    expect(prediction).toContain('path = path_key(track["path"])');
    expect(script).toContain("if cid is None and len(candidates) > 1:");
    expect(script).not.toContain("first wins");
  });

  test("tmp workspace sanity (script contract is stable JSON)", async () => {
    const dir = tempDir("megadj-rb-playlist-").dir();
    const p = join(dir, "payload.json");
    writeFileSync(
      p,
      JSON.stringify({
        chain: [{ path: "/archive/a.mp3", base: "a.mp3", title: "A" }],
      }),
    );
    const parsed = JSON.parse(await Bun.file(p).text()) as {
      chain: { path: string; base: string }[];
    };
    expect(parsed.chain[0]?.base).toBe("a.mp3");
    expect(parsed.chain[0]?.path).toBe("/archive/a.mp3");
  });
});

describe("#283-followup: option passthrough integrity", () => {
  const rbSource = readFileSync(
    join(import.meta.dir, "rb-playlist.ts"),
    "utf8",
  );

  test("--search reaches the engine (it parsed but was never forwarded — a silent no-op flag)", () => {
    // Regression: rb-playlist accepted --search at the CLI but buildMegaset
    // never received it, so a forced beam/greedy silently ran the auto
    // choice (measured divergence: identical megaset args gave 18 vs 23
    // tracks). Pin the full forwarding chain by source: CLI parses the
    // flag, dispatch forwards it, engine call consumes it.
    const cli = readFileSync(join(import.meta.dir, "cli-commands.ts"), "utf8");
    expect(cli).toContain(
      'parseMegasetSearchOverride(flags.strings.get("search"))',
    );
    expect(rbSource).toContain("searchOverride: opts.search");
    expect(rbSource).toContain("search?: SetSearchOverride | undefined");
  });

  test("buildChain passes the configured shelf Contents root (relocated tracks must not shrink the pool)", () => {
    // Regression: a bare ArchiveReader(DB_PATH) resolved relocated strays
    // (378-shelf-rescue) as missing → smaller pool → shorter chain. The
    // constructor now receives the same configured root the megaset CLI
    // passes.
    expect(rbSource).toContain(
      'join(cfg.volumesRoot, cfg.shelfDrive, "Contents")',
    );
  });
});
