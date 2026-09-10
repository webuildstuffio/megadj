import { describe, test, expect } from "bun:test";
import { join } from "node:path";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  intakePhaseFor,
  splitIntakeStdout,
  intakeArgs,
  megadjCliPath,
  ensureIntakeWatchDir,
  INTAKE_FILE_LINE,
} from "../src/intake_run";

describe("intakePhaseFor", () => {
  test("maps megadj's own log lines onto forward-only phases", () => {
    let idx = 0;
    // probe marker (walk line)
    const probe = intakePhaseFor("18 audio file(s) under /tmp/dump", idx);
    expect(probe).not.toBeNull();
    expect(probe!.progress).toBe(0.02);
    expect(probe!.nextIdx).toBe(0);
    idx = probe!.nextIdx;
    // dedupe marker (in-batch dupe)
    const dupe = intakePhaseFor(
      "  [dupe] a.wav — byte-identical twin of b.wav (md5)",
      idx,
    );
    expect(dupe).not.toBeNull();
    expect(dupe!.progress).toBe(0.15);
    idx = dupe!.nextIdx;
    // archive-check marker: Phase-C's "already in archive" line must win
    // over the dedupe "[dupe]" class when dedupe already ran
    const arch = intakePhaseFor(
      "  [dupe] c.wav already in archive: c.wav — quarantining",
      idx,
    );
    expect(arch).not.toBeNull();
    expect(arch!.progress).toBe(0.3);
    idx = arch!.nextIdx;
    // enrich marker: real Phase-D row (two-space indent, kept raw)
    const enrich = intakePhaseFor("  = ok: some track.aiff", idx);
    expect(enrich).not.toBeNull();
    expect(enrich!.progress).toBe(0.4);
    idx = enrich!.nextIdx;
    // done marker
    const done = intakePhaseFor("done: 17 retagged, 12 artwork embedded", idx);
    expect(done).not.toBeNull();
    expect(done!.progress).toBe(0.9);
  });

  test("never rewinds on repeated lines", () => {
    // after the last phase, no marker matches again
    expect(intakePhaseFor("18 audio file(s) under /x", 4)).toBeNull();
    expect(intakePhaseFor("  [dupe] x", 4)).toBeNull();
    expect(intakePhaseFor("done: nothing", 4)).toBeNull();
  });

  test("per-file rows carry the two-space indent (raw match)", () => {
    // the trimmed regex regression: "  ~ file: title" never matched
    expect(INTAKE_FILE_LINE.test("  ~ file.wav: title, artist")).toBe(true);
    expect(INTAKE_FILE_LINE.test("  = ok: file.wav")).toBe(true);
    expect(INTAKE_FILE_LINE.test("  ⛔ player-incompatible (x): f.wav")).toBe(
      true,
    );
    expect(INTAKE_FILE_LINE.test("~ no indent")).toBe(false);
  });
});

describe("splitIntakeStdout", () => {
  test("splits the human log from the trailing --json object", () => {
    const out =
      "intake folder: 2026-09-10 dump/\n" +
      "18 audio file(s) under /tmp/dump\n" +
      '{"command":"ingest","files":18,"tagged":17}';
    const { log, summary } = splitIntakeStdout(out);
    expect(log).toContain("intake folder:");
    expect(summary).not.toBeNull();
    expect((summary as Record<string, unknown>).files).toBe(18);
  });

  test("returns null summary when no JSON landed (crashed run)", () => {
    const { summary } = splitIntakeStdout("just log lines\n");
    expect(summary).toBeNull();
  });
});

describe("argv builders", () => {
  test("intakeArgs targets the given folder with --json last", () => {
    expect(intakeArgs("/tmp/dump")).toEqual(["ingest", "/tmp/dump", "--json"]);
  });
  test("megadjCliPath resolves the repo CLI from cfg.root (cratedeck/)", () => {
    expect(megadjCliPath("/x/megadj/cratedeck")).toBe("/x/megadj/src/cli.ts");
  });
});

describe("ensureIntakeWatchDir", () => {
  test("creates a missing watch folder so the drop point exists", () => {
    const base = mkdtempSync(join(tmpdir(), "intake-watch-"));
    const musicDir = join(base, "archive");
    mkdirSync(musicDir, { recursive: true });
    const watch = ensureIntakeWatchDir({ musicDir });
    expect(watch).toBe(join(musicDir, "..", "Downloads"));
    expect(existsSync(watch)).toBe(true);
    rmSync(base, { recursive: true, force: true });
  });

  test("is idempotent — existing folder stays untouched", () => {
    const base = mkdtempSync(join(tmpdir(), "intake-watch-"));
    const musicDir = join(base, "archive");
    const watch = join(musicDir, "..", "Downloads");
    mkdirSync(watch, { recursive: true });
    writeFileSync(join(watch, "keep.wav"), "x");
    ensureIntakeWatchDir({ musicDir });
    expect(existsSync(join(watch, "keep.wav"))).toBe(true);
    rmSync(base, { recursive: true, force: true });
  });

  test("MEGADJ_INTAKE_WATCH override is honored and created", () => {
    const base = mkdtempSync(join(tmpdir(), "intake-watch-"));
    process.env.MEGADJ_INTAKE_WATCH = join(base, "custom", "drop");
    try {
      const watch = ensureIntakeWatchDir({ musicDir: join(base, "archive") });
      expect(watch).toBe(join(base, "custom", "drop"));
      expect(existsSync(watch)).toBe(true);
    } finally {
      delete process.env.MEGADJ_INTAKE_WATCH;
      rmSync(base, { recursive: true, force: true });
    }
  });
});
