/**
 * anlz.ts — pure rekordbox ANLZ sidecar decode (plan GA-03/GA-04): the
 * PMAI container walk + the PQTZ beat grid, so grid audits can compare
 * OUR fitted grids against the grid rekordbox ACTually wrote — anchor
 * delta, phase — instead of only the DB's rounded BPM.
 *
 * Format per Deep-Symmetry/crate-digger `rekordbox_anlz.ksy`, the
 * djl-analysis.deepsymmetry.org field guide, and the fourfour
 * PIONEER.md reference (three independent sources, all agreeing):
 *
 *   PMAI  28-byte file header (magic + total length 28)
 *   PPTH  16-byte header + UTF-16BE device-relative audio path
 *   PQTZ  24-byte header (unknown2 = 0x00080000) + N × 8-byte beats:
 *         beat_number u16be (1–4, 1 = downbeat), tempo u16be (BPM×100),
 *         time u32be (ms at 100% pitch)
 *
 * Pure: bytes in, plain objects out. No I/O — the command seam reads the
 * files. The fixture builder (`buildAnlz`) round-trips through the
 * parser, which is how the grid tests and the triage tests get honest
 * input without a mounted drive.
 */

/** One PQTZ beat entry. */
export interface AnlzBeat {
  /** Beat within the bar: 1 (downbeat) … 4. */
  num: number;
  /** Tempo at this beat, BPM × 100 (rekordbox's 0.01 precision). */
  bpmx100: number;
  /** Time of this beat, ms. */
  timeMs: number;
}

/** A decoded PQTZ beat grid + the audio path it belongs to. */
export interface AnlzGrid {
  /** UTF-16BE path from PPTH — the device-relative audio path. */
  path: string;
  beats: AnlzBeat[];
}

/** Section inventory of one ANLZ file — the GA-07 spike's "exactly which
 * files/fields change" view (tag → byte length). */
export interface AnlzInventory {
  path: string;
  sections: Array<{ tag: string; bytes: number }>;
}

const dec = new TextDecoder("utf-16be");

function u32be(b: Uint8Array, off: number): number {
  return (
    ((b[off]! << 24) |
      (b[off + 1]! << 16) |
      (b[off + 2]! << 8) |
      b[off + 3]!) >>>
    0
  );
}

function u16be(b: Uint8Array, off: number): number {
  return ((b[off]! << 8) | b[off + 1]!) >>> 0;
}

function tag(b: Uint8Array, off: number): string {
  return String.fromCharCode(b[off]!, b[off + 1]!, b[off + 2]!, b[off + 3]!);
}

/**
 * Walk the PMAI container: returns the PPTH path and every section's
 * (tag, offset, total length). Null on any structural violation —
 * corrupt sidecars are a visible null, never a partial parse.
 */
function walkContainer(data: Uint8Array): {
  path: string;
  sections: Array<{ tag: string; off: number; total: number }>;
} | null {
  if (data.length < 44) return null;
  if (tag(data, 0) !== "PMAI") return null;
  if (u32be(data, 4) !== 28) return null;
  if (tag(data, 28) !== "PPTH") return null;
  const plen = u32be(data, 40);
  if (plen === 0 || 44 + plen > data.length) return null;
  // strip trailing NULs without a control-char regex (oxlint eslint rule)
  const raw = dec.decode(data.subarray(44, 44 + plen));
  let end = raw.length;
  while (end > 0 && raw.charCodeAt(end - 1) === 0) end--;
  const path = raw.slice(0, end);
  const sections: Array<{ tag: string; off: number; total: number }> = [];
  let off = 44 + plen;
  while (off < data.length) {
    if (off + 12 > data.length) return null;
    const t = tag(data, off);
    const total = u32be(data, off + 8);
    if (total < 24 || off + total > data.length) return null;
    sections.push({ tag: t, off, total });
    off += total;
  }
  return { path, sections };
}

/**
 * Decode the PQTZ beat grid from ANLZ bytes. Null when the file is
 * malformed or carries no grid (older/waveform-only sidecars).
 */
export function parseAnlzGrid(data: Uint8Array): AnlzGrid | null {
  const c = walkContainer(data);
  if (!c) return null;
  const pq = c.sections.find((s) => s.tag === "PQTZ");
  if (!pq) return null;
  const off = pq.off;
  // PQTZ: [tag 4][hdrLen 4 = 24][total 4][unknown1 4][unknown2 4][count 4]
  if (u32be(data, off + 4) !== 24) return null;
  const count = u32be(data, off + 20);
  if (count === 0 || 24 + count * 8 > pq.total) return null;
  const beats: AnlzBeat[] = [];
  for (let i = 0; i < count; i++) {
    const e = off + 24 + i * 8;
    const num = u16be(data, e);
    const bpmx100 = u16be(data, e + 2);
    const timeMs = u32be(data, e + 4);
    if (num < 1 || num > 4 || bpmx100 === 0) return null;
    beats.push({ num, bpmx100, timeMs });
  }
  return { path: c.path, beats };
}

/** Section inventory only (the GA-07 spike's cheap diff view). */
export function parseAnlzInventory(data: Uint8Array): AnlzInventory | null {
  const c = walkContainer(data);
  if (!c) return null;
  return {
    path: c.path,
    sections: c.sections.map((s) => ({ tag: s.tag, bytes: s.total })),
  };
}

/** Encode a JS string as UTF-16BE bytes + the NUL terminator (Bun's
 * Buffer lacks a "utf-16be" encoding label; TextDecoder decodes it fine,
 * so the write side is explicit). */
function utf16be(s: string): Uint8Array {
  const out = new Uint8Array(s.length * 2 + 2);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[i * 2] = c >> 8;
    out[i * 2 + 1] = c & 0xff;
  }
  return out; // trailing 2 bytes are the NUL terminator
}

/**
 * Build ANLZ bytes from parts — the test-fixture seam AND the spike
 * tooling's writer if it ever needs one. Deterministic; round-trips
 * through `parseAnlzGrid`/`parseAnlzInventory`.
 */
export function buildAnlz(opts: {
  path: string;
  beats?: AnlzBeat[];
  extraSections?: Array<{ tag: string; bytes: number }>;
}): Uint8Array {
  const pathBytes = utf16be(opts.path);

  const out: Uint8Array[] = [];
  const head = new Uint8Array(44);
  const dv = new DataView(head.buffer);
  head.set([0x50, 0x4d, 0x41, 0x49], 0); // PMAI
  dv.setUint32(4, 28, false);
  head.set([0x50, 0x50, 0x54, 0x48], 28); // PPTH
  dv.setUint32(32, 16, false); // PPTH header length
  dv.setUint32(36, 0, false);
  dv.setUint32(40, pathBytes.length, false);
  out.push(head, pathBytes);
  for (const s of opts.extraSections ?? []) {
    // minimal section: tag + hdrLen 24 + total 24 + padding zeros
    const b = new Uint8Array(s.bytes);
    b.set(
      [
        s.tag.charCodeAt(0),
        s.tag.charCodeAt(1),
        s.tag.charCodeAt(2),
        s.tag.charCodeAt(3),
      ],
      0,
    );
    const sdv = new DataView(b.buffer);
    sdv.setUint32(4, 24, false);
    sdv.setUint32(8, s.bytes, false);
    out.push(b);
  }
  if (opts.beats && opts.beats.length > 0) {
    const total = 24 + opts.beats.length * 8;
    const b = new Uint8Array(total);
    const bdv = new DataView(b.buffer);
    b.set([0x50, 0x51, 0x54, 0x5a], 0); // PQTZ
    bdv.setUint32(4, 24, false);
    bdv.setUint32(8, total, false);
    bdv.setUint32(12, 0, false); // unknown1
    bdv.setUint32(16, 0x00080000, false); // unknown2 — the constant
    bdv.setUint32(20, opts.beats.length, false);
    opts.beats.forEach((be, i) => {
      const e = 24 + i * 8;
      bdv.setUint16(e, be.num, false);
      bdv.setUint16(e + 2, be.bpmx100, false);
      bdv.setUint32(e + 4, be.timeMs, false);
    });
    out.push(b);
  }
  const len = out.reduce((n, a) => n + a.length, 0);
  const all = new Uint8Array(len);
  let o = 0;
  for (const a of out) {
    all.set(a, o);
    o += a.length;
  }
  return all;
}
