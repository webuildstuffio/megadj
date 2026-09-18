import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import { join } from "node:path";
import { moveQuarantineFile } from "./ingest-probe";
import { tempDir } from "../../test-support/testutil";

describe("quarantine moves", () => {
  const t = tempDir("megadj-quarantine-test-");
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) t.dispose(dir);
  });

  test("cross-device fallback verifies and removes the source", async () => {
    const dir = t.dir();
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
