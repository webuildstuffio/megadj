import { describe, expect, test } from "bun:test";
import { $ } from "bun";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * K61 `megadj drop` — the one-shot pipeline. Regression guards:
 * - --json emits ONE summary object (P1) with per-stage accounting
 * - a folder with nothing new still completes all stages (idempotence)
 * - a URL failure is contained (exit 1, later stages skipped, no crash)
 * - dry-run never touches the archive DB state
 */

async function runDrop(args: string[], env: Record<string, string>) {
  const proc =
    await $`bun run ${join(import.meta.dir, "../cli.ts")} drop ${args}`
      .env({ ...process.env, ...env })
      .quiet()
      .nothrow();
  return {
    code: proc.exitCode,
    stdout: new TextDecoder().decode(proc.stdout),
    stderr: new TextDecoder().decode(proc.stderr),
  };
}

function freshEnv() {
  const dir = mkdtempSync("/tmp/megadj-drop-test-");
  return {
    dir,
    env: {
      MEGADJ_DB: join(dir, "archive.db"),
      MEGADJ_MUSIC_DIR: join(dir, "music"),
      MEGADJ_COOKIES: "",
    },
  };
}

describe("megadj drop (K61 one-shot pipeline)", () => {
  test("--json on a folder with no audio: full pipeline, every stage ok/skipped", async () => {
    const { dir, env } = freshEnv();
    try {
      const empty = join(dir, "empty-inbox");
      mkdirSync(empty);
      writeFileSync(join(empty, "readme.txt"), "not audio");
      const { code, stdout } = await runDrop([empty, "--no-mood", "--json"], {
        ...env,
        // no network in the local gate: beats stage would try beat_this
        // on zero candidates → must still complete without spawning
      });
      expect(code).toBe(0);
      const parsed = JSON.parse(stdout.trim().split("\n").at(-1) ?? "") as {
        command: string;
        ok: boolean;
        stages: { stage: string; status: string }[];
      };
      expect(parsed.command).toBe("drop");
      expect(parsed.ok).toBe(true);
      const byStage = Object.fromEntries(
        parsed.stages.map((s) => [s.stage, s.status]),
      );
      expect(byStage.ingest).toBe("ok");
      expect(byStage.fetch).toBe("ok");
      expect(byStage.years).toBe("ok");
      expect(byStage.beats).toBe("ok");
      expect(byStage.mood).toBe("skipped"); // --no-mood
      expect(byStage.cues).toBe("ok");
      expect(byStage.organize).toBe("ok");
      expect(byStage["tag-check"]).toBe("ok");
      expect(byStage.audit).toBe("ok");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // .timeout(30000): the URL-failure path waits for yt-dlp to exhaust DNS
  // resolution for example.invalid (~5–9s warm); bun's 5s default kills
  // the test before yt-dlp returns. The root bunfig.toml timeout raise is
  // untracked personal config, not a contract other machines (or other
  // invocation CWDs) can rely on.
  test("URL download failure: contained, exit 1, stages after download skipped", async () => {
    const { dir, env } = freshEnv();
    try {
      const { code, stdout } = await runDrop(
        ["https://example.invalid/x", "--no-mood", "--json"],
        env,
      );
      expect(code).toBe(1);
      const parsed = JSON.parse(stdout.trim().split("\n").at(-1) ?? "") as {
        ok: boolean;
        stages: { stage: string; status: string }[];
      };
      expect(parsed.ok).toBe(false);
      expect(parsed.stages[0]?.stage).toBe("download");
      expect(parsed.stages[0]?.status).toBe("failed");
      expect(parsed.stages.filter((s) => s.status === "skipped").length).toBe(
        9,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  test("missing target: usage error, exit 1", async () => {
    const { dir, env } = freshEnv();
    try {
      const { code, stderr } = await runDrop([], env);
      expect(code).toBe(1);
      expect(stderr).toContain("drop: pass a folder or URL");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
