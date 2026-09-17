/**
 * FullTags tag-health — the corrupt-ID3 scanner.
 *
 * Sibling of `booth-text.ts` (which answers "will the booth READ it");
 * this module answers "is the tag STRUCTURE sound". Four classes of
 * defect, found in the wild during the Sep 10-11 intake sweeps:
 *
 *  1. UNREADABLE CONTAINER. ffprobe exits non-zero or mutagen throws
 *     (truncated download, bad ID3 header, ID3NoHeaderError) — the file
 *     may PLAY (players recover) but every tag tool reads garbage or
 *     nothing, and rekordbox analysis can silently skip the tags.
 *  2. MUTAGEN/FFPROBE DISAGREEMENT. ffprobe sees tags the mutagen pass
 *     can't (or vice versa) — usually a malformed frame or an ID3v2.2
 *     relic. One writer's tags not surviving a read means a later
 *     enrichment pass (full-record replace semantics) will DROP them.
 *  3. SUSPECT TEXT. The tag TEXT is present but broken: mojibake
 *     (double-encoded UTF-8 — the booth-text classes, re-checked here
 *     on the tag level), control bytes inside frame text, or a title
 *     that is empty-after-trim.
 *  4. CRITICAL-FRAME VOID. A nominally tagged file with NO title/artist
 *     — reads as "tagged" to tools that only test tag presence, but the
 *     identity fields are empty (the "why does this track show Unknown
 *     Artist" trap).
 *
 * Verdict shape matches player-compat/booth-text: `ok` + machine
 * `reasons` + human `detail`, so audit/scan callers treat all three
 * gates identically.
 */
import { groundTruth } from "./readers";
import { boothTextCompat, hasControlChars, isMojibake } from "./booth-text";

export interface TagHealth {
  ok: boolean;
  /** Machine reasons, stable strings — callers switch on these. */
  reasons: string[];
  /** Human one-liner combining the findings. */
  detail: string;
}

/** Scan one file's tag structure. Synchronous (mutagen reader is sync). */
export function tagHealth(path: string): TagHealth {
  const reasons: string[] = [];
  const t = groundTruth(path);

  // Class 1+2 proxy: groundTruth merges ffprobe + mutagen; if BOTH legs
  // returned nothing at all AND the file has no title, the container's
  // tag area is unreadable (a genuinely untagged file and a corrupt one
  // look identical to a single reader — this is the cheap union check).
  // The distinguishing probe is ffprobe's own stderr, already logged at
  // the readers.ts boundary on parse failure.
  if (!t.title && !t.artist) reasons.push("no-title-artist");

  // Class 3: suspect text on the identity frames. Mojibake detection is
  // the booth-text SSOT (isMojibake) — a local heuristic here FALSE-
  // POSITIVED every legit accented name ("Hernández", "Café"): naive
  // Latin-1 round-tripping can't tell an isolated accent from a
  // double-encode (found live, Sep 11 2026).
  for (const [label, v] of [
    ["title", t.title],
    ["artist", t.artist],
    ["album", t.album],
  ] as const) {
    if (v == null) continue;
    if (isMojibake(v)) reasons.push(`mojibake-${label}`);
    // Control-byte detection is booth-text's SSOT (hasControlChars) — same
    // C0/DEL/C1 verdict the path check uses, one definition.
    if (hasControlChars(v)) reasons.push(`control-bytes-${label}`);
  }

  // Class 3b: display-level text compat (tofu/mojibake/path chars) —
  // booth-text owns the fleet-facing verdicts; its failures are tag-health
  // failures too (a tag that garbles on the booth is a broken tag).
  const bt = boothTextCompat({
    filename: path.split("/").pop() ?? path,
    title: t.title,
    artist: t.artist,
    album: t.album,
    genre: t.genre,
    relPath: path,
  });
  if (!bt.ok) reasons.push(...bt.reasons.map((r) => `booth-text:${r}`));

  return {
    ok: reasons.length === 0,
    reasons,
    detail:
      reasons.length === 0
        ? "tags parse clean"
        : `${reasons.length} issue(s): ${reasons.join(", ")}`,
  };
}
