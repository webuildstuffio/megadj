import { afterEach, describe, expect, test } from "bun:test";
import { $ } from "bun";
import { mkdirSync, readFileSync } from "node:fs";
import { writeFakeAudio } from "../../test-support/audio-fixtures";
import { join } from "node:path";
import { expandZips, pendingZipDeletes } from "./ingest-zips";
import { tempDir } from "../../test-support/testutil";

describe("zip ingest safety", () => {
  const t = tempDir("megadj-zip-test-");
  const dirs: string[] = [];

  afterEach(() => {
    pendingZipDeletes.clear();
    for (const dir of dirs.splice(0)) t.dispose(dir);
  });

  test("keeps same-name files when same size does not mean same bytes", async () => {
    const root = t.dir();
    dirs.push(root);
    const source = join(root, "source");
    const cd1 = join(source, "CD1");
    const cd2 = join(source, "CD2");
    mkdirSync(cd1, { recursive: true });
    mkdirSync(cd2, { recursive: true });
    writeFakeAudio(join(cd1, "01 - Track.mp3"), Buffer.from("AAAA"));
    writeFakeAudio(join(cd2, "01 - Track.mp3"), Buffer.from("BBBB"));
    const zip = join(root, "multi-disc.zip");
    await $`ditto -c -k --sequesterRsrc --keepParent ${source} ${zip}`.quiet();

    await expandZips(
      root,
      false,
      async (dir) => {
        const out: string[] = [];
        const proc = await $`find ${dir} -type f -name '*.mp3'`.quiet();
        for (const line of proc.stdout.toString().trim().split("\n"))
          if (line) out.push(line);
        return out;
      },
      () => {},
    );

    const staged = [...pendingZipDeletes.values()][0] ?? [];
    expect(staged).toHaveLength(2);
    expect(
      readFileSync(join(root, staged[0]!)).equals(
        readFileSync(join(root, staged[1]!)),
      ),
    ).toBe(false);
  });
});
