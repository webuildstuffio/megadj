// jobs-drain.test.ts — regression: drain() must capture subprocess stdout
// exactly once per byte. The old loop did `out += chunk` where chunk was
// `carry + text` (carry = previous chunk's unparsed tail), re-counting the
// carry on every iteration — the captured verify output grew duplicated
// text through the whole report (summary, raw log, offender context).
import { describe, it, expect } from "bun:test";
import { drain } from "../jobs/engine";

function spawnWriter(
  chunks: string[],
  opts: { delayMs?: number } = {},
): Bun.Subprocess {
  const script = `
    const chunks = ${JSON.stringify(chunks)};
    const delay = ${opts.delayMs ?? 0};
    for (const c of chunks) {
      process.stdout.write(c);
      if (delay) await new Promise((r) => setTimeout(r, delay));
    }
  `;
  return Bun.spawn(["bun", "-e", script], {
    stdout: "pipe",
    stderr: "ignore",
  });
}

describe("drain stdout capture", () => {
  it("captures split lines without duplication", async () => {
    // deliberately split mid-line and mid-token across chunk boundaries
    const proc = spawnWriter([
      "tracks: 10\npla",
      "ylists: 3\nFINAL: ALL PASS\n",
    ]);
    const lines: string[] = [];
    const { out } = await drain(proc, (l) => lines.push(l), {
      cancelled: false,
    });
    expect(lines).toEqual(["tracks: 10", "playlists: 3", "FINAL: ALL PASS"]);
    expect(out).toBe("tracks: 10\nplaylists: 3\nFINAL: ALL PASS\n");
  });

  it("long multi-chunk output contains each byte exactly once", async () => {
    const chunk = "hashed 100/3500 analysis files\n".repeat(8);
    const proc = spawnWriter(Array(10).fill(chunk), { delayMs: 1 });
    const { out } = await drain(proc, () => {}, { cancelled: false });
    const expected = chunk.repeat(10);
    expect(out.length).toBe(expected.length);
    expect(out).toBe(expected);
  });

  it("keeps multi-byte UTF-8 intact across a chunk split", async () => {
    // "café ✓" — é and ✓ are multi-byte; force the split between their bytes
    const s = "track — café ✓ good\n";
    const bytes = new TextEncoder().encode(s);
    const cut = s.includes("✓") ? 14 : 10; // inside the ✓ sequence
    const head = bytes.slice(0, cut);
    const tail = bytes.slice(cut);
    const script = [
      `const head = new Uint8Array([${head.join(",")}]);`,
      `const tail = new Uint8Array([${tail.join(",")}]);`,
      "process.stdout.write(head);",
      "await new Promise((r) => setTimeout(r, 10));",
      "process.stdout.write(tail);",
    ].join("\n");
    const proc = Bun.spawn(["bun", "-e", script], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const { out } = await drain(proc, () => {}, { cancelled: false });
    expect(out).toBe(s);
  });

  it("delivers a final UNTERMINATED line to onLine (the #228 carry flush)", async () => {
    // issue #228: the loop pops the trailing partial into `carry`; the
    // bytes reached `out` (post-loop decode flush) but carry was never
    // handed to onLine — a child whose last progress line lacks "\n"
    // lost its final tick to every onLine consumer.
    const proc = spawnWriter(["phase 1 done\nfinal phase 100%"]);
    const lines: string[] = [];
    const { out } = await drain(proc, (l) => lines.push(l), {
      cancelled: false,
    });
    expect(lines).toEqual(["phase 1 done", "final phase 100%"]);
    expect(out).toBe("phase 1 done\nfinal phase 100%");
  });

  it("never delivers a blank carry line", async () => {
    // trailing "\n" leaves an empty carry; the flush is trim-guarded so
    // onLine never sees a phantom blank tick
    const proc = spawnWriter(["a\n\n"]);
    const lines: string[] = [];
    await drain(proc, (l) => lines.push(l), { cancelled: false });
    expect(lines).toEqual(["a"]);
  });
});
