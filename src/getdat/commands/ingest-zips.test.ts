import { afterEach, describe, expect, test } from "bun:test";
import { $ } from "bun";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { expandZips, pendingZipDeletes } from "./ingest-zips";

describe("zip ingest safety", () => {
  const dirs: string[] = [];

  afterEach(() => {
    pendingZipDeletes.clear();
    for (const dir of dirs.splice(0))
      rmSync(dir, { recursive: true, force: true });
  });

  test("keeps same-name files when same size does not mean same bytes", async () => {
    const root = mkdtempSync("/tmp/megadj-zip-test-");
    dirs.push(root);
    const source = join(root, "source");
    const cd1 = join(source, "CD1");
    const cd2 = join(source, "CD2");
    mkdirSync(cd1, { recursive: true });
    mkdirSync(cd2, { recursive: true });
    writeFileSync(join(cd1, "01 - Track.mp3"), Buffer.from("AAAA"));
    writeFileSync(join(cd2, "01 - Track.mp3"), Buffer.from("BBBB"));
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
