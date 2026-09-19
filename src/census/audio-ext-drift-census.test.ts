import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Audio-extension census (#200). The #69 SSOT's membership regrew private
// twins within weeks (rb-import dropped .alac; hygiene_audio missed
// .ogg/.opus; scan.ts carried a 7-entry cousin). MEMBERSHIP-based tripwire:
// any `new Set([…])` quoting ≥3 SSOT extensions outside the SSOT fails, so
// a renamed twin is caught exactly like the original. (Artwork/mime sets
// quote ≤2; ingest-art's ARTWORK_EXTS derives from the SSOT, no literal.)
const ROOT = join(import.meta.dir, "..", "..");
const SELF = join(ROOT, "src/census/audio-ext-drift-census.test.ts");
const SSOT = [
  ".m4a",
  ".mp3",
  ".wav",
  ".flac",
  ".aiff",
  ".aif",
  ".ogg",
  ".opus",
  ".aac",
  ".alac",
];

function* repoFiles(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      yield* repoFiles(p);
    } else if (/\.(ts|tsx)$/.test(e.name)) yield p;
  }
}

/** Max SSOT exts in any one `new Set([…])` literal (no nested brackets). */
function maxSsotExtsPerSetLiteral(text: string): number {
  let max = 0;
  for (const m of text.matchAll(/new\s+Set(?:<[^>]*>)?\(\s*\[([^\]]*)/g)) {
    const n = SSOT.filter((e) => m[1]?.includes(`"${e}"`)).length;
    if (n > max) max = n;
  }
  return max;
}

test("census: no hand-rolled audio-extension Set outside the SSOT", () => {
  const offenders: string[] = [];
  for (const dir of ["src", "fulltags", "cratedeck/src", "cratedeck/shared"]) {
    const abs = join(ROOT, dir);
    if (!existsSync(abs)) continue;
    for (const p of repoFiles(abs)) {
      if (
        p !== SELF &&
        !p.includes("shared/audio-exts") &&
        maxSsotExtsPerSetLiteral(readFileSync(p, "utf8")) >= 3
      )
        offenders.push(p);
    }
  }
  expect(offenders).toEqual([]);
});

test("census: the three former twins read the SSOT", () => {
  const pinned: [string, RegExp][] = [
    [
      "src/rekordbox/rb-import.ts",
      /import \{ AUDIO_EXTS \} from "\.\.\/shared\/audio-exts"/,
    ],
    [
      "cratedeck/src/hygiene-audio.ts",
      /import \{ AUDIO_EXTS \} from "\.\.\/\.\.\/src\/shared\/audio-exts"/,
    ],
    [
      "cratedeck/src/scan.ts",
      /export \{ AUDIO_EXTS as AUDIO_EXT \} from "\.\.\/\.\.\/src\/shared\/audio-exts"/,
    ],
  ];
  for (const [rel, re] of pinned) {
    expect({
      file: rel,
      readsSsot: re.test(readFileSync(join(ROOT, rel), "utf8")),
    }).toEqual({ file: rel, readsSsot: true });
  }
});

test("detector fires on rb-import's old twin, passes a 2-ext mime set", () => {
  expect(
    maxSsotExtsPerSetLiteral(
      'const A = new Set([".aiff", ".aif", ".mp3", ".wav", ".flac", ".m4a", ".aac"]);',
    ),
  ).toBe(7);
  expect(maxSsotExtsPerSetLiteral('const M = new Set([".mp3", ".wav"]);')).toBe(
    2,
  );
});
