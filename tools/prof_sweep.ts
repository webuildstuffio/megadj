/**
 * prof_sweep.ts — cold/warm I/O profiler for the runtime hot paths the
 * perf plan targets (see plan.md at the repo root): tree walk + stat,
 * full-tree read (sweep proxy), and blake2b hashing. Read-only.
 *
 * Usage: bun tools/prof_sweep.ts [dir]   (default: MEGADJ_MUSIC_DIR env or
 * ~/Music/DJ-Imports — same resolution as cratedeck's config.ts).
 *
 * Warm-cache numbers overstate throughput: the page cache absorbs the
 * whole tree on repeat runs. For honest disk numbers, unplug/replug the
 * USB drive between runs (or `sudo purge` on the internal SSD).
 */
import { readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";

const DIR =
  process.argv[2] ??
  process.env.MEGADJ_MUSIC_DIR ??
  `${process.env.HOME}/Music/DJ-Imports`;

async function walkCollect(dir: string, out: string[] = []): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) await walkCollect(p, out);
    else if (e.isFile() && !e.name.startsWith("._")) out.push(p);
  }
  return out;
}

async function statsSerial(paths: string[]): Promise<void> {
  const t = performance.now();
  let n = 0;
  for (const p of paths) {
    try {
      await stat(p);
      n++;
    } catch {
      // vanished mid-profile — count only what stat'd
    }
  }
  console.log(
    `stat serial : ${String(n).padStart(5)} files  ${(performance.now() - t).toFixed(0)} ms`,
  );
}

async function statsBatch(paths: string[], width = 32): Promise<void> {
  const t = performance.now();
  let i = 0;
  let n = 0;
  const workers = Array.from({ length: width }, async () => {
    for (;;) {
      const idx = i++;
      if (idx >= paths.length) return;
      try {
        await stat(paths[idx]!);
        n++;
      } catch {
        // same as serial: skip vanished files
      }
    }
  });
  await Promise.all(workers);
  console.log(
    `stat batch${String(width).padStart(3)}: ${String(n).padStart(5)} files  ${(performance.now() - t).toFixed(0)} ms`,
  );
}

async function readOne(p: string): Promise<number> {
  return (await Bun.file(p).arrayBuffer()).byteLength;
}

async function runPool(
  label: string,
  paths: string[],
  width: number,
  op: (p: string) => Promise<number>,
): Promise<void> {
  const t = performance.now();
  let bytes = 0;
  let i = 0;
  const workers = Array.from({ length: width }, async () => {
    for (;;) {
      const idx = i++;
      if (idx >= paths.length) return;
      bytes += await op(paths[idx]!);
    }
  });
  await Promise.all(workers);
  const ms = performance.now() - t;
  const mbs = bytes / 1e6 / (ms / 1000);
  console.log(
    `${label.padEnd(12)}: ${(bytes / 1e9).toFixed(2)} GB  ${ms.toFixed(0)} ms  (${mbs.toFixed(0)} MB/s)`,
  );
}

const files = await walkCollect(DIR);
if (!files.length) {
  console.error(`no files under ${DIR}`);
  process.exit(1);
}
console.log(`tree: ${files.length} files under ${DIR}`);
await statsSerial(files);
await statsBatch(files);
const big: string[] = [];
for (const p of files) {
  const st = await stat(p);
  if (st.size > 0) big.push(p);
}
await runPool("read serial", big, 1, readOne);
await runPool("read pool x4", big, 4, readOne);
await runPool("read pool x8", big, 8, readOne);
await runPool("hash serial", big, 1, async (p) => {
  const bytes = new Uint8Array(await Bun.file(p).arrayBuffer());
  createHash("blake2b256").update(bytes).digest("hex");
  return bytes.byteLength;
});
await runPool("hash pool x4", big, 4, async (p) => {
  const bytes = new Uint8Array(await Bun.file(p).arrayBuffer());
  createHash("blake2b256").update(bytes).digest("hex");
  return bytes.byteLength;
});
