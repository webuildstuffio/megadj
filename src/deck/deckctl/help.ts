// deckctl/help.ts — `deckctl help [term|kind]` and `deckctl dismiss
// <drive> <noteId>` (rev 4 surface-parity twins: GAP-10/11).
//
// Extracted from deckctl.ts (file-length guard), like deckctl/notes.ts:
// the help verb is self-contained — it reads the shared/help.ts SSOT
// DIRECTLY (no server call), which is the point: an agent on a cold
// machine asks "what does Ghost mean" and gets the same wording the UI
// tooltips render. Dismiss is the CLI twin of the UI timeline's dismiss
// button — agents landed the note (deckctl note / deck_note), agents can
// retire it once the human confirms. History is kept; the feed skips it.
//
// Uses deckctl's output helpers via the exported hooks pattern
// (JSON mode + log/errOut + exit), and printKindDoc for job entries —
// one implementation of "explain a job" across the help/explain verbs.

import { HELP_JOBS, HELP_SURFACES, HELP_TERMS } from "../shared/help";
import { resolveDriveOrExit, dismissNote } from "../deckapi";
import { KIND_DOCS, printKindDoc } from "./docs";
import { emitJson } from "./runtime";

/** Print hooks shared with deckctl.ts (deckctl/notes.ts pattern). */
export interface HelpPrintHooks {
  /** true when --json is on: emit one JSON object, no prose. */
  jsonMode: boolean;
  log: (s: string) => void;
  errOut: (s: string) => void;
  exit: (code: number) => never;
}

/** `deckctl help [term|kind]` — the in-app help SSOT as a CLI verb. */
export async function cmdHelp(
  h: HelpPrintHooks,
  topic?: string,
): Promise<void> {
  const t = topic?.trim().toLowerCase();
  if (t) {
    // single glossary term or job kind — the `explain`-style deep dive.
    // Job kinds are canonical ids ("scan", "mirror"…) and win over same-
    // named glossary terms; everything else resolves to a term (exact,
    // then prefix) so "ghost" and "g" both hit.
    const job = HELP_JOBS.find((x) => x.kind === t);
    const term = job
      ? undefined
      : (HELP_TERMS.find((x) => x.term.toLowerCase() === t) ??
        HELP_TERMS.find((x) => x.term.toLowerCase().startsWith(t)));
    if (term) {
      if (h.jsonMode) {
        await emitJson({ term });
        return;
      }
      h.log(`── ${term.term} ──`);
      h.log(term.def);
      h.log(`why it matters: ${term.why}`);
      return;
    }
    if (job) {
      if (h.jsonMode) {
        await emitJson({ job });
        return;
      }
      // `needs` comes from KIND_DOCS (the explain SSOT) — the hand-rolled
      // two-way ternary here was a #216-class twin that printed "requires:
      // drive mounted, rekordbox closed" for ingest/speedtest/checksum,
      // none of which is true for those kinds.
      printKindDoc(
        job.kind,
        {
          what: job.what,
          typical: job.duration,
          safe: job.safety,
          needs: KIND_DOCS[job.kind]?.needs ?? "",
        },
        h.log,
      );
      h.log(`when to run: ${job.when}`);
      return;
    }
    h.errOut(
      `no help entry for "${topic}" — try a glossary term (${HELP_TERMS.length} available) or a job kind (${HELP_JOBS.map((j) => j.kind).join(", ")})`,
    );
    h.exit(2);
  }
  if (h.jsonMode) {
    await emitJson({
      terms: HELP_TERMS,
      jobs: HELP_JOBS,
      surfaces: HELP_SURFACES,
    });
    return;
  }
  h.log("── vocabulary ──");
  for (const term of HELP_TERMS) h.log(`  ${term.term}: ${term.def}`);
  h.log("");
  h.log("── the jobs ──");
  for (const j of HELP_JOBS) h.log(`  ${j.label.toLowerCase()} — ${j.what}`);
  h.log("");
  h.log("── where everything lives ──");
  for (const s of HELP_SURFACES)
    h.log(`  ${s.label} (${s.route}): ${s.question}`);
  h.log("");
  h.log("deep dive per job kind: deckctl explain [kind]");
}

/** `deckctl dismiss <drive> <noteId>` — retire a note from the active feed. */
export async function cmdDismiss(
  h: HelpPrintHooks,
  nameOrId: string,
  noteId: string,
): Promise<void> {
  const d = await resolveDriveOrExit(h, nameOrId);
  try {
    await dismissNote(d.id, noteId);
  } catch (e) {
    const err = e as Error & { status?: number };
    h.errOut(err.message);
    h.exit(err.status === 404 ? 2 : 1);
  }
  if (h.jsonMode)
    await emitJson({ dismissed: true, drive: d.name, id: noteId });
  else h.log(`✓ note dismissed on ${d.nickname ?? d.name}`);
}
