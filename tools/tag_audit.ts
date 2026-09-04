/**
 * tools/tag_audit.ts — scan the archive for tag completeness.
 * Reports files with zero core tags (title/artist/album/genre/date),
 * partial tags, and full tags. Read-only.
 */
import { $ } from "bun";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const home = process.env.HOME!;
const roots = [`${home}/Music/DJ-Imports`];
const CORE = ["title", "artist", "album", "genre", "date"];
const zeroTags: Array<[string, string]> = [];
const partial: Array<[string, string]> = [];
let ok = 0;
let total = 0;

for (const root of roots) {
  const ents = await readdir(root, { withFileTypes: true });
  for (const e of ents) {
    if (e.name.startsWith(".") || !/\.(m4a|mp3|wav|aiff|flac)$/i.test(e.name))
      continue;
    total++;
    const p = join(root, e.name);
    const pr = await $`ffprobe -v error -print_format json -show_format ${p}`
      .quiet()
      .nothrow();
    if (pr.exitCode !== 0) {
      zeroTags.push([e.name, "UNREADABLE"]);
      continue;
    }
    const stdout =
      typeof pr.stdout === "string" ? pr.stdout : pr.stdout.toString();
    const tags = JSON.parse(stdout).format?.tags ?? {};
    const filled = CORE.filter((k) => {
      const v = tags[k] ?? tags[k.toUpperCase()] ?? tags[`©${k}`];
      return v && String(v).trim().length > 0;
    });
    if (filled.length === 0) zeroTags.push([e.name, "0 core tags"]);
    else if (filled.length < 3)
      partial.push([e.name, `${filled.length} tags: ${filled.join(",")}`]);
    else ok++;
  }
}

console.log("total files in archive root:", total);
console.log("full (3+ core tags):", ok);
console.log("partial (<3):", partial.length);
for (const [n, info] of partial.slice(0, 12)) console.log("  ~", n, "—", info);
console.log("ZERO core tags:", zeroTags.length);
for (const [n, info] of zeroTags.slice(0, 12)) console.log("  ✗", n, "—", info);
