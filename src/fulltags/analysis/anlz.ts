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
  sections: { tag: string; bytes: number }[];
}

/** One PSSI phrase entry from the song structure section. */
export interface AnlzPhrase {
  /** Phrase number, 1-based. */
  index: number;
  /** Beat at which this phrase starts. */
  beat: number;
  /** Phrase kind (mood-specific enum — see PHRASE_KINDS). */
  kind: number;
  /** Fill-in present at end of phrase? */
  fill: boolean;
  /** Beat at which fill-in starts (meaningful only when fill is true). */
  beatFill: number;
}

/**
 * Track mood assigned during phrase analysis.
 * Determines how phrase `kind` codes are labeled.
 */
export const TRACK_MOOD = {
  HIGH: 1, // up/down style (white label text in RB)
  MID: 2, // bridge-verse style (black label text in RB)
  LOW: 3, // bridge-verse variant with verse1/verse2 split
} as const;

/**
 * Phrase kind enums per mood type.
 * HIGH mood: INTRO=1, UP=2, DOWN=3, CHORUS=5, OUTRO=6
 * MID mood: INTRO=1, VERSE1-6=2-7, BRIDGE=8, CHORUS=9, OUTRO=10
 * LOW mood: same as MID but verses split into 1a-c / 2a-c
 */
export const PHRASE_KINDS = {
  /** Phrase kinds for HIGH mood (up-down style). */
  HIGH: {
    INTRO: 1,
    UP: 2,
    DOWN: 3,
    CHORUS: 5,
    OUTRO: 6,
  },
  /** Phrase kinds for MID/LOW mood (bridge-verse style). */
  MID: {
    INTRO: 1,
    VERSE1: 2,
    VERSE2: 3,
    VERSE3: 4,
    VERSE4: 5,
    VERSE5: 6,
    VERSE6: 7,
    BRIDGE: 8,
    CHORUS: 9,
    OUTRO: 10,
  },
} as const;

/** Decoded PSSI phrase structure from an ANLZ .EXT file. */
export interface AnlzPhrases {
  /** UTF-16BE path from PPTH — the device-relative audio path. */
  readonly path: string;
  /** Track mood (1=high, 2=mid, 3=low). */
  readonly mood: number;
  /** Beat number at which the last recognized phrase ends. */
  readonly endBeat: number;
  /** Ordered phrase entries. */
  readonly phrases: readonly AnlzPhrase[];
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
  sections: { tag: string; off: number; total: number }[];
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
  const sections: { tag: string; off: number; total: number }[] = [];
  let off = 44 + plen;
  while (off < data.length) {
    if (off + 12 > data.length) return null;
    const t = tag(data, off);
    const total = u32be(data, off + 8);
    if (total < 12 || off + total > data.length) return null;
    sections.push({ tag: t, off, total });
    off += total;
  }
  return { path, sections };
}

/**
 * XOR mask for RB6 PSSI obfuscation.
 * The mask repeats every 19 bytes and is derived from the phrase count `c`.
 */
function pssiMask(c: number): Uint8Array {
  return new Uint8Array([
    (0xcb + c) & 0xff,
    (0xe1 + c) & 0xff,
    (0xee + c) & 0xff,
    (0xfa + c) & 0xff,
    (0xe5 + c) & 0xff,
    (0xee + c) & 0xff,
    (0xad + c) & 0xff,
    (0xee + c) & 0xff,
    (0xe9 + c) & 0xff,
    (0xd2 + c) & 0xff,
    (0xe9 + c) & 0xff,
    (0xeb + c) & 0xff,
    (0xe1 + c) & 0xff,
    (0xe9 + c) & 0xff,
    (0xf3 + c) & 0xff,
    (0xe8 + c) & 0xff,
    (0xe9 + c) & 0xff,
    (0xf4 + c) & 0xff,
    (0xe1 + c) & 0xff,
  ]);
}

/**
 * Decode the PSSI phrase structure from ANLZ .EXT bytes.
 * Null when the file is malformed or has no phrase section.
 *
 * Handles RB6's XOR obfuscation: when `raw_mood > 20` the body
 * bytes after `num_entries` are masked with a 19-byte repeating key
 * derived from the entry count — obfuscation, not encryption.
 *
 * Layout (offsets relative to PSSI section start):
 *   +00 tag "PSSI"  +04 len_header (32)  +08 len_total
 *   +12 len_entry_bytes (u32, always 24)
 *   +16 num_entries (u16)
 *   +18 raw_mood (u16) — if >20, body is masked
 *   +20..25 unknown  +26 end_beat (u16)  +28..31 unknown
 *   +32 entries[] (each 24 bytes)
 */
export function parseAnlzPhrases(data: Uint8Array): AnlzPhrases | null {
  const c = walkContainer(data);
  if (!c) return null;
  const ps = c.sections.find((s) => s.tag === "PSSI");
  if (!ps) return null;
  const { off, total } = ps;

  // Verify header length
  const hdrLen = u32be(data, off + 4);
  if (hdrLen !== 32) return null;

  const lenEntryBytes = u32be(data, off + 12);
  if (lenEntryBytes !== 24) return null;

  const numEntries = u16be(data, off + 16);
  if (numEntries === 0) return null;
  if (hdrLen + numEntries * lenEntryBytes > total) return null;

  // Check masking via raw_mood — a real mood is 1-3
  const rawMood = u16be(data, off + 18);
  const isMasked = rawMood > 20;

  // The body from +18 onward may need unmasking
  const bodyStart = off + 18;
  const body = new Uint8Array(data.slice(bodyStart, off + total));

  if (isMasked) {
    const mask = pssiMask(numEntries);
    for (let i = 0; i < body.length; i++) {
      // oxlint-disable-next-line operator-assignment -- ^= on indexed Uint8Array trips noUncheckedIndexedAccess
      body[i] = body[i]! ^ mask[i % mask.length]!;
    }
  }

  // Now read from the unmasked body (offsets relative to body start = +18)
  const mood = u16be(body, 0);
  if (mood < 1 || mood > 3) return null;

  const endBeat = u16be(body, 8); // at +26 in section = +8 in body

  const phrases: AnlzPhrase[] = [];
  const entryBase = 14; // entries at +32 in section = +14 in body
  for (let i = 0; i < numEntries; i++) {
    const e = entryBase + i * lenEntryBytes;
    if (e + lenEntryBytes > body.length) break;
    const index = u16be(body, e);
    const beat = u16be(body, e + 2);
    const kind = u16be(body, e + 4);
    // fill flag at entry byte 21, beatFill at entry bytes 22-23 (bounds-safe: e+24 ≤ body.length)
    const fill = body[e + 21]! !== 0;
    const beatFill = u16be(body, e + 22);
    phrases.push({ index, beat, kind, fill, beatFill });
  }

  return { path: c.path, mood, endBeat, phrases };
}

/**
 * Compute intro/outro bar counts from PSSI phrases.
 * Returns { introBars, outroBars } with raw bar counts (not yet rounded).
 */
export function phraseInOutBars(p: AnlzPhrases): {
  introBars: number;
  outroBars: number;
} {
  const introKind = 1; // INTRO is always kind=1 in all moods
  const outroKind = p.mood === TRACK_MOOD.HIGH ? 6 : 10;

  let introBars = 0;
  let outroBars = 0;

  // First phrase with kind=INTRO
  const introIdx = p.phrases.findIndex((ph) => ph.kind === introKind);
  if (introIdx !== -1) {
    const intro = p.phrases[introIdx]!;
    const nextBeat =
      introIdx + 1 < p.phrases.length
        ? p.phrases[introIdx + 1]!.beat
        : p.endBeat;
    introBars = Math.floor((nextBeat - intro.beat) / 4);
  }

  // Last phrase with kind=OUTRO
  const outroIdx = p.phrases.findLastIndex((ph) => ph.kind === outroKind);
  if (outroIdx !== -1) {
    const outro = p.phrases[outroIdx]!;
    const nextBeat =
      outroIdx + 1 < p.phrases.length
        ? p.phrases[outroIdx + 1]!.beat
        : p.endBeat;
    outroBars = Math.floor((nextBeat - outro.beat) / 4);
  }

  return { introBars, outroBars };
}

/**
 * Classify whether a track has a drop or a rolling groove from PSSI.
 *
 * HIGH mood: CHORUS (kind=5) sections are drops.
 * MID/LOW mood: CHORUS (kind=9) sections are drops.
 *
 * "Drop" = the track has at least one CHORUS section whose bar length
 * is ≥ 8 bars (a real structural drop, not a brief fill).
 * "Roll" = no qualifying drop sections — the track rolls without a
 * big structural contrast (verse/bridge/up/down only).
 */
export function phraseDropRoll(p: AnlzPhrases): {
  drop: boolean;
  roll: boolean;
} {
  const chorusKind = p.mood === TRACK_MOOD.HIGH ? 5 : 9;
  const introKind = 1;
  const outroKind = p.mood === TRACK_MOOD.HIGH ? 6 : 10;

  // Find CHORUS sections with ≥ 8 bars (real drops, not fills)
  for (let i = 0; i < p.phrases.length; i++) {
    const ph = p.phrases[i]!;
    if (ph.kind !== chorusKind) continue;
    // Skip if this is the only phrase type (weak signal)
    const nextBeat =
      i + 1 < p.phrases.length ? p.phrases[i + 1]!.beat : p.endBeat;
    const bars = Math.floor((nextBeat - ph.beat) / 4);
    if (bars >= 8) return { drop: true, roll: false };
  }

  // No qualifying drop — check for rolling structure
  // A roll needs at least 2 non-intro/outro phrases to be meaningful
  // Small chorus sections (<8 bars) count as body content, not drops
  const bodyPhrases = p.phrases.filter(
    (ph) => ph.kind !== introKind && ph.kind !== outroKind,
  );
  if (bodyPhrases.length >= 2) return { drop: false, roll: true };

  return { drop: false, roll: false };
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
  const { off } = pq;
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
 * rewriteAnlzGrid — GA-07 Q4's armament: replace the PQTZ beat grid
 * inside an ANLZ container WITHOUT touching any other section byte.
 *
 * The container walk (PMAI → sections) stays byte-exact: every section
 * before and after the PQTZ is copied verbatim, so PWAV/PCOB/PSDN
 * waveforms and artwork survive untouched — only the grid's byte span
 * differs, and only when the beat count changed (same count = same
 * length, beat entries rewritten in place).
 *
 * Invariants (all pinned in anlz.test.ts):
 *   - output parses back through `parseAnlzGrid` to exactly `beats`
 *   - `parseAnlzInventory` is unchanged unless the beat count changed
 *   - sections outside PQTZ are byte-identical to the input
 *   - no PQTZ section in the input → null (nothing to edit; callers
 *     must NOT fabricate one — a grid without the track's real section
 *     layout is a corruption vector)
 */
export function rewriteAnlzGrid(
  data: Uint8Array,
  beats: AnlzBeat[],
): Uint8Array | null {
  const c = walkContainer(data);
  if (!c) return null;
  const pq = c.sections.find((s) => s.tag === "PQTZ");
  if (!pq) return null;

  const total = 24 + beats.length * 8;
  const grid = new Uint8Array(total);
  const dv = new DataView(grid.buffer);
  grid.set([0x50, 0x51, 0x54, 0x5a], 0); // PQTZ
  dv.setUint32(4, 24, false);
  dv.setUint32(8, total, false);
  dv.setUint32(12, 0, false); // unknown1 (kept as buildAnlz writes it)
  dv.setUint32(16, 0x00080000, false); // unknown2 — the constant
  dv.setUint32(20, beats.length, false);
  beats.forEach((be, i) => {
    const e = 24 + i * 8;
    dv.setUint16(e, be.num, false);
    dv.setUint16(e + 2, be.bpmx100, false);
    dv.setUint32(e + 4, be.timeMs, false);
  });

  const out = new Uint8Array(data.length - pq.total + total);
  out.set(data.subarray(0, pq.off), 0);
  out.set(grid, pq.off);
  out.set(data.subarray(pq.off + pq.total), pq.off + total);
  return out;
}

/** Input for building a PSSI test fixture. */
export interface BuildPssiInput {
  mood: number;
  endBeat: number;
  entries: { index: number; beat: number; kind: number }[];
}

/**
 * Build ANLZ bytes from parts — the test-fixture seam AND the spike
 * tooling's writer if it ever needs one. Deterministic; round-trips
 * through `parseAnlzGrid`/`parseAnlzInventory`/`parseAnlzPhrases`.
 */
export function buildAnlz(opts: {
  path: string;
  beats?: AnlzBeat[];
  phrases?: BuildPssiInput;
  extraSections?: { tag: string; bytes: number }[];
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
  if (opts.phrases) {
    // Build an UNMASKED PSSI section (mood ≤ 3 → parser skips unmasking)
    const { mood, endBeat, entries } = opts.phrases;
    const entrySize = 24;
    const hdr = 32;
    const pssiTotal = hdr + entries.length * entrySize;
    const pssi = new Uint8Array(pssiTotal);
    const pdv = new DataView(pssi.buffer);
    pssi.set([0x50, 0x53, 0x53, 0x49], 0); // PSSI
    pdv.setUint32(4, hdr, false); // len_header
    pdv.setUint32(8, pssiTotal, false); // len_total
    pdv.setUint32(12, entrySize, false); // len_entry_bytes
    pdv.setUint16(16, entries.length, false); // num_entries
    pdv.setUint16(18, mood, false); // mood (unmasked)
    pdv.setUint16(26, endBeat, false); // end_beat
    for (let i = 0; i < entries.length; i++) {
      const e = hdr + i * entrySize;
      const en = entries[i]!;
      pdv.setUint16(e, en.index, false);
      pdv.setUint16(e + 2, en.beat, false);
      pdv.setUint16(e + 4, en.kind, false);
    }
    out.push(pssi);
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
