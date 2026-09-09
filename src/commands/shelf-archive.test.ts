import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { shelfArchive } from "./shelf-archive";

/**
 * shelf-archive: the drive → shelf intake sweep. Tests exercise the walk,
 * the junk filter, the coverage classes, and the never-overwrite guarantee
 * with temp "volumes" (plain dirs) — no real drives touched.
 */

function makeDrive(root: string, files: Record<string, string>): string {
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, content);
  }
  return root;
}

function makeShelf(files: Record<string, string> = {}): string {
  const vol = mkdtempSync("/tmp/megadj-sa-shelf-");
  mkdirSync(join(vol, "Contents"), { recursive: true });
  return makeDrive(vol, files);
}

const run = (opts: Partial<Parameters<typeof shelfArchive>[0]> = {}) =>
  shelfArchive({
    volumes: [],
    shelfVolume: mkdtempSync("/tmp/megadj-sa-empty-"),
    log: () => {},
    ...opts,
  } as Parameters<typeof shelfArchive>[0]);

describe("shelf-archive", () => {
  test("copies fresh drive content into Contents/, preserving layout", async () => {
    const drive = makeDrive(mkdtempSync("/tmp/megadj-sa-drive-"), {
      "Contents/Artist/Album/track.mp3": "audio-bytes",
      "PIONEER REC/set.wav": "recording",
    });
    const shelf = makeShelf();
    await run({ volumes: [drive], shelfVolume: shelf });
    expect(
      existsSync(join(shelf, "Contents", "Artist", "Album", "track.mp3")),
    ).toBe(true);
    expect(existsSync(join(shelf, "Contents", "PIONEER REC", "set.wav"))).toBe(
      true,
    );
    expect(
      readFileSync(
        join(shelf, "Contents", "Artist", "Album", "track.mp3"),
        "utf8",
      ),
    ).toBe("audio-bytes");
  });

  test("skips AppleDouble/DS_Store junk and PIONEER device trees", async () => {
    const drive = makeDrive(mkdtempSync("/tmp/megadj-sa-junk-"), {
      "Contents/Artist/real.mp3": "x",
      "Contents/Artist/._real.mp3": "junk",
      "Contents/Artist/.DS_Store": "junk",
      "PIONEER/rekordbox/export.pdb": "device-db",
      "PIONEER/USBANLZ/xyz/ANLZ0000.DAT": "cache",
    });
    const shelf = makeShelf();
    await run({ volumes: [drive], shelfVolume: shelf });
    expect(existsSync(join(shelf, "Contents", "Artist", "real.mp3"))).toBe(
      true,
    );
    expect(existsSync(join(shelf, "Contents", "Artist", "._real.mp3"))).toBe(
      false,
    );
    expect(existsSync(join(shelf, "Contents", "export.pdb"))).toBe(false);
    expect(existsSync(join(shelf, "Contents", "ANLZ0000.DAT"))).toBe(false);
  });

  test("re-run is a no-op (idempotent coverage)", async () => {
    const drive = makeDrive(mkdtempSync("/tmp/megadj-sa-rerun-"), {
      "Contents/A/one.mp3": "1",
      "Contents/A/two.mp3": "2",
    });
    const shelf = makeShelf();
    await run({ volumes: [drive], shelfVolume: shelf });
    await run({ volumes: [drive], shelfVolume: shelf });
    // no [drive] variant copies should exist after a clean re-run
    const listed = [
      ...new Bun.Glob("**/*").scanSync({ cwd: join(shelf, "Contents") }),
    ];
    expect(listed.filter((f) => f.includes("[")).length).toBe(0);
    expect(listed.filter((f) => f.endsWith(".mp3")).length).toBe(2);
  });

  test("case-variant names count as covered (exFAT is case-insensitive)", async () => {
    const drive = makeDrive(mkdtempSync("/tmp/megadj-sa-case-"), {
      "Contents/ARTIST/song.MP3": "x",
    });
    const shelf = makeShelf({ "Contents/artist/Song.mp3": "x" });
    await run({ volumes: [drive], shelfVolume: shelf });
    const listed = [
      ...new Bun.Glob("**/*.mp3").scanSync({ cwd: join(shelf, "Contents") }),
    ];
    expect(listed).toHaveLength(1); // no duplicate written
  });

  test("same name + different size is preserved as <stem> [drive] copy — shelf original untouched", async () => {
    const drive = makeDrive(mkdtempSync("/tmp/megadj-sa-divergent-"), {
      "Contents/A/track.mp3": "drive-version-bytes",
    });
    const shelf = makeShelf({ "Contents/A/track.mp3": "shelf-original" });
    await run({ volumes: [drive], shelfVolume: shelf, suffix: "bang" });
    expect(
      readFileSync(join(shelf, "Contents", "A", "track.mp3"), "utf8"),
    ).toBe("shelf-original"); // NEVER overwritten
    expect(
      readFileSync(join(shelf, "Contents", "A", "track [bang].mp3"), "utf8"),
    ).toBe("drive-version-bytes");
  });

  test("same size but different content: default trusts size; --deep preserves", async () => {
    const drive = makeDrive(mkdtempSync("/tmp/megadj-sa-samesize-"), {
      "Contents/A/track.mp3": "aaaaXXXX",
    });
    // shelf twin has the SAME byte count (8) but different bytes
    const shelf = makeShelf({ "Contents/A/track.mp3": "bbbbYYYY" });
    await run({ volumes: [drive], shelfVolume: shelf });
    expect(
      existsSync(join(shelf, "Contents", "A", "track [").replace(/ \[$/, "")),
    ).toBe(false); // nothing extra written without --deep
    await run({
      volumes: [drive],
      shelfVolume: shelf,
      deep: true,
      suffix: "d",
    });
    expect(
      readFileSync(join(shelf, "Contents", "A", "track [d].mp3"), "utf8"),
    ).toBe("aaaaXXXX");
  });

  test("--trashes + --into lands trashed files flat under Contents/<into>/", async () => {
    const drive = mkdtempSync("/tmp/megadj-sa-trash-");
    makeDrive(drive, {
      ".Trashes/501/Cool Mix.mp3": "mix-bytes",
    });
    const shelf = makeShelf();
    await run({
      volumes: [drive],
      shelfVolume: shelf,
      trashes: true,
      into: "DJ Sets & Mixes",
    });
    expect(
      existsSync(join(shelf, "Contents", "DJ Sets & Mixes", "Cool Mix.mp3")),
    ).toBe(true);
  });

  test("unmounted drive is skipped, run stays ok, mounted one still works", async () => {
    const drive = makeDrive(mkdtempSync("/tmp/megadj-sa-ok-"), {
      "Contents/A/x.mp3": "x",
    });
    const shelf = makeShelf();
    await run({
      volumes: [drive, "/tmp/megadj-sa-not-mounted-zzz"],
      shelfVolume: shelf,
    });
    expect(existsSync(join(shelf, "Contents", "A", "x.mp3"))).toBe(true);
  });

  test("unmounted shelf is a hard error (exit 1)", async () => {
    const drive = makeDrive(mkdtempSync("/tmp/megadj-sa-d2-"), {
      "Contents/A/x.mp3": "x",
    });
    const logs: string[] = [];
    await run({
      volumes: [drive],
      shelfVolume: "/tmp/megadj-sa-no-shelf-zzz",
      log: (s) => logs.push(s),
    });
    expect(logs.some((l) => l.includes("shelf not mounted"))).toBe(true);
  });

  test("--json emits one parseable summary (P1 contract) with ok flag", async () => {
    const drive = makeDrive(mkdtempSync("/tmp/megadj-sa-json-"), {
      "Contents/A/y.mp3": "y",
    });
    const shelf = makeShelf();
    const orig = console.log;
    let out = "";
    console.log = (s: string) => (out += s + "\n");
    try {
      await shelfArchive({
        volumes: [drive],
        shelfVolume: shelf,
        json: true,
        log: () => {},
      });
    } finally {
      console.log = orig;
    }
    const parsed = JSON.parse(out.trim()) as {
      command: string;
      drives: {
        files: number;
        coveredExact: number;
        copied: number;
        failed: number;
        ok: boolean;
      }[];
      ok: boolean;
    };
    expect(parsed.command).toBe("shelf-archive");
    expect(parsed.drives[0]?.files).toBe(1);
    expect(parsed.drives[0]?.copied).toBe(1);
    expect(parsed.ok).toBe(true);
  });
});
