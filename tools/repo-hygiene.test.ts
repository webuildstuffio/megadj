import { describe, expect, test } from "bun:test";
import { repoHygiene } from "./repo-hygiene";

describe("repoHygiene", () => {
  test("the tracked index does not contain ignored artifacts", () => {
    expect(repoHygiene()).toEqual({ ok: true, trackedIgnored: [] });
  });

  test("generated roots and secrets are ignored without hiding examples", () => {
    for (const path of [
      "artifacts/run.json",
      "outputs/result.json",
      "logs/run.jsonl",
      "tmp/work.bin",
      "temp/work.bin",
      "embeddings/raw.npy",
      ".env.local",
    ]) {
      expect(
        Bun.spawnSync(["git", "check-ignore", "--no-index", "-q", path])
          .exitCode,
        path,
      ).toBe(0);
    }
    expect(
      Bun.spawnSync(["git", "check-ignore", "--no-index", "-q", ".env.example"])
        .exitCode,
    ).not.toBe(0);
    expect(
      Bun.spawnSync([
        "git",
        "check-ignore",
        "--no-index",
        "-q",
        "experiments/definition.toml",
      ]).exitCode,
    ).not.toBe(0);
  });
});
