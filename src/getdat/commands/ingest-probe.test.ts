import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { copyFile } from "node:fs/promises";
import { join } from "node:path";
import { moveQuarantineFile } from "./ingest-probe";

describe("quarantine moves", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0))
      rmSync(dir, { recursive: true, force: true });
  });

  test("cross-device fallback verifies and removes the source", async () => {
    const dir = mkdtempSync("/tmp/megadj-quarantine-test-");
    dirs.push(dir);
    const source = join(dir, "source.mp3");
    const dest = join(dir, "quarantine", "source.mp3");
    mkdirSync(join(dir, "quarantine"));
    writeFileSync(source, "audio bytes");

    await moveQuarantineFile(
      source,
      dest,
      async () => {
        const error = new Error("EXDEV") as NodeJS.ErrnoException;
        error.code = "EXDEV";
        throw error;
      },
      async (from, to) => {
        await copyFile(from, to);
      },
    );

    expect(existsSync(source)).toBe(false);
    expect(readFileSync(dest, "utf8")).toBe("audio bytes");
  });
});
