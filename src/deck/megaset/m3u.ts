// m3u.ts — the ONE M3U8 export seam (rev-52 root-cause fix). The
// single-set route's inline renderer was unshareable, so the cohorts
// route shipped with a parsed-but-ignored `?format=m3u8` — the
// `--kind` parsed-but-dropped class, on HTTP: a query param a route
// never reads is a silent no-op lie. Every /api/archive/* playlist
// export now renders through HERE: one control-char guard, one
// metadata-only skip rule, one header set, one format gate.
//
// Read-only: rendering is pure over the caller's steps + a path index.
// File paths stay server-side by contract (ArchiveSetCandidate.filePath
// is stripped before any JSON serialization — the m3u8 download is the
// one surface that legitimately carries them).
import type { MegasetStep } from "../shared/megaset";
import type { CohortPlan } from "./cohorts";

/** The `format` query-param gate — shared by both set-builder routes.
 *  Absent/blank = json (the wire default); `m3u8` = the Rekordbox
 *  playlist; ANYTHING ELSE is an error, never a silent JSON
 *  fall-through (a caller who asked for a file must not be handed a
 *  payload that only looks like success). */
export function parseFormatParam(
  raw: string | null,
): "m3u8" | "json" | { error: string } {
  if (raw === null || raw.trim() === "") return "json";
  const v = raw.trim().toLowerCase();
  if (v === "json") return "json";
  if (v === "m3u8") return "m3u8";
  return {
    error: `unknown format "${raw}" — supported: json (default), m3u8`,
  };
}

/** M3U comment fields are one physical line; strip control characters
 *  rather than allowing track metadata to inject playlist directives.
 *  Built from code points instead of a literal control-char class
 *  (no-control-regex). */
const M3U_CONTROL_CHARS = new RegExp(
  `[${String.fromCharCode(0x00)}-${String.fromCharCode(
    0x1f,
  )}${String.fromCharCode(0x7f)}]+`,
  "g",
);
function m3uText(value: string | null, fallback: string): string {
  return (value ?? fallback).replaceAll(M3U_CONTROL_CHARS, " ").trim();
}

/** The per-candidate fields the playlist needs — the map deliberately
 *  hides the rest of the census row (scoring internals never leak into
 *  a download). */
export interface M3uCandidate {
  filePath: string | null;
  durationS: number | null;
  metadataOnly: boolean;
}

/** Index the census candidates by id for path lookup. Accepts the full
 *  ArchiveSetCandidate rows structurally — no wire twin. */
export function m3uCandidateIndex(
  candidates: readonly {
    videoId: string;
    filePath: string | null;
    durationS: number | null;
    metadataOnly: boolean;
  }[],
): Map<string, M3uCandidate> {
  return new Map(
    candidates.map((c) => [
      c.videoId,
      {
        filePath: c.filePath,
        durationS: c.durationS,
        metadataOnly: c.metadataOnly,
      },
    ]),
  );
}

export interface M3uRender {
  lines: string[];
  /** B1 (#104): steps with no mounted file are NOT dead entries — they
   *  are counted so the export tells the truth about what it dropped. */
  skippedMetadataOnly: number;
}

/** One set's chain → playlist lines. #106 Phase D: derived handoff
 *  windows ride as #EXTREM comments (rekordbox import keeps them as
 *  track descriptions; positions are seconds from track start). */
export function m3uSetLines(
  steps: readonly MegasetStep[],
  candidateById: ReadonlyMap<string, M3uCandidate>,
): M3uRender {
  const lines = ["#EXTM3U"];
  let skippedMetadataOnly = 0;
  for (const step of steps) {
    const candidate = candidateById.get(step.videoId);
    if (!candidate?.filePath) {
      if (candidate?.metadataOnly) skippedMetadataOnly++;
      continue;
    }
    const duration = Math.max(0, Math.round(candidate.durationS ?? 300));
    const artist = m3uText(step.artist, "Unknown artist");
    const title = m3uText(step.title, step.videoId);
    const filePath = m3uText(candidate.filePath, "");
    if (!filePath) continue;
    const windows = [
      step.mixInCue
        ? `mix-in @ ${Math.round(step.mixInCue.position)}s (bar ${step.mixInCue.bar})`
        : null,
      step.mixOutCue
        ? `mix-out @ ${Math.round(step.mixOutCue.position)}s (bar ${step.mixOutCue.bar})`
        : null,
    ].filter((part) => part !== null);
    lines.push(
      `#EXTINF:${duration},${artist} - ${title}`,
      ...(windows.length > 0 ? [`#EXTREM:${windows.join(" · ")}`] : []),
      filePath,
    );
  }
  return { lines, skippedMetadataOnly };
}

/** The counted skip note — ONE text for every export surface (the
 *  boundary test pins it; a second wording would be a twin). */
export function m3uSkipNote(total: number, skipped: number): string {
  return `# megadj: ${skipped} of ${total} proposal tracks skipped — no mounted file (shelf offline; rebuild after mounting to get the full playlist)`;
}

/** The whole cohort session → ONE importable playlist: family by
 *  family, warmup then peak, with `#`-comment section headers carrying
 *  the plan (plain # lines are legal M3U and stay readable everywhere;
 *  rekordbox imports the tracks in order). A SHORT arm says SHORT in
 *  its header — the export never dresses up a shortfall. */
export function m3uCohortSessionLines(
  plan: CohortPlan,
  candidateById: ReadonlyMap<string, M3uCandidate>,
): M3uRender {
  const lines = [
    "#EXTM3U",
    `# megadj cohort session — ${plan.minutes}min per arm · families: ${plan.families.join(", ")}`,
    "# import through Rekordbox File → Import → Playlist; this file never opens or mutates master.db",
  ];
  let skippedMetadataOnly = 0;
  let totalSteps = 0;
  for (const row of plan.cohorts) {
    for (const arm of [row.warmup, row.peak]) {
      const flag = arm.complete
        ? `${arm.actualMinutes}m`
        : `${arm.actualMinutes}m, SHORT ${arm.shortfallMinutes}m`;
      lines.push(`# --- ${row.family} · ${arm.preset} (${flag}) ---`);
      const rendered = m3uSetLines(arm.chain, candidateById);
      skippedMetadataOnly += rendered.skippedMetadataOnly;
      totalSteps += arm.chain.length;
      // slice(1): drop the nested #EXTM3U — one playlist, one header
      lines.push(...rendered.lines.slice(1));
    }
  }
  if (skippedMetadataOnly > 0) {
    lines.push(m3uSkipNote(totalSteps, skippedMetadataOnly));
  }
  return { lines, skippedMetadataOnly };
}

/** The download Response — ONE header set (the single-set route and the
 *  cohorts route must not drift on Content-Type or disposition). */
export function m3uResponse(
  lines: readonly string[],
  filename: string,
): Response {
  return new Response(`${lines.join("\n")}\n`, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
    },
  });
}
