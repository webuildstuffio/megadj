// deckctl_notes.ts — `deckctl note|notes` (O88 findings feed from the CLI).
//
// Extracted from deckctl.ts (file-length guard): the CLI surface keeps
// growing one verb at a time, and the note/notes pair is self-contained —
// resolve drive → POST/GET the notes routes → print. Uses deckctl's
// output helpers via the exported hooks (JSON mode + log/errOut + exit).
//
// Note wire shapes come from the shared SSOT (notes.ts `StoredNote`), not
// re-declared here — a local duplicate drifts silently (the Sep 7
// ArchiveTab bug class: same-length local types hide server shape changes
// until the UI renders `[object Object]`).

import { apiGet, apiPost, resolveDrive } from "./deckapi";
import type { StoredNote } from "./notes";

export interface NotePrintHooks {
  /** true when --json is on: emit one JSON object, no prose. */
  jsonMode: boolean;
  log: (s: string) => void;
  errOut: (s: string) => void;
  /** argv, for `--severity` flag parsing on `note`. */
  argv: string[];
  exit: (code: number) => never;
}

async function getJson<T>(p: string): Promise<T> {
  const res = await apiGet(p);
  return (await res.json()) as T;
}

/** `deckctl note <drive> <text> [--severity s]` — lands a timeline card. */
export async function cmdNote(
  h: NotePrintHooks,
  nameOrId: string,
  text: string,
): Promise<void> {
  const sevIdx = h.argv.indexOf("--severity");
  const severity = sevIdx >= 0 ? h.argv[sevIdx + 1] : undefined;
  const d = await resolveDrive(nameOrId);
  if (!d) {
    h.errOut(`unknown drive: ${nameOrId}`);
    h.exit(2);
  }
  const res = await apiPost(`/api/drives/${d.id}/notes`, {
    note: text,
    severity,
    origin: "deckctl",
  });
  const body = (await res.json()) as { id?: string; error?: string };
  if (!res.ok) {
    h.errOut(`note rejected: ${body.error ?? res.status}`);
    h.exit(1);
  }
  if (h.jsonMode) {
    console.log(JSON.stringify({ posted: true, id: body.id }, null, 2));
    return;
  }
  h.log(`✓ note landed on ${d.nickname ?? d.name} (dismiss it in the UI)`);
}

/** `deckctl notes [drive]` — the active (undismissed) findings feed. */
export async function cmdNotes(
  h: NotePrintHooks,
  nameOrId?: string,
): Promise<void> {
  if (!nameOrId) {
    // P1: --json must work on every verb, in every branch (agent-first
    // contract). One JSON object covering every drive's feed.
    const drives =
      await getJson<{ id: string; name: string; nickname: string | null }[]>(
        "/api/drives",
      );
    const perDrive: { drive: string; notes: StoredNote[] }[] = [];
    for (const d of drives) {
      const notes = await getJson<StoredNote[]>(
        `/api/drives/${d.id}/notes`,
      ).catch(() => [] as StoredNote[]);
      perDrive.push({ drive: d.nickname ?? d.name, notes });
      if (!h.jsonMode)
        for (const n of notes)
          h.log(`${d.nickname ?? d.name} [${n.severity}] ${n.note}`);
    }
    if (h.jsonMode) console.log(JSON.stringify({ notes: perDrive }, null, 2));
    return;
  }
  const d = await resolveDrive(nameOrId);
  if (!d) {
    h.errOut(`unknown drive: ${nameOrId}`);
    h.exit(2);
  }
  const notes = await getJson<StoredNote[]>(`/api/drives/${d.id}/notes`);
  if (h.jsonMode) {
    console.log(JSON.stringify({ drive: d.name, notes }, null, 2));
    return;
  }
  for (const n of notes)
    h.log(`[${n.severity}] ${n.note} (${new Date(n.at).toISOString()})`);
  if (!notes.length) h.log("(no active notes)");
}

/** `deckctl rename <drive> [nickname]` — set/clear the display nickname.
 *  CLI twin of the UI's rename dialog and POST /api/drives/:id/name
 *  (surface-parity GAP-7); omitting the nickname clears it. */
export async function cmdRename(
  h: NotePrintHooks,
  nameOrId: string,
  nickname: string | null,
): Promise<void> {
  const d = await resolveDrive(nameOrId);
  if (!d) {
    h.errOut(`unknown drive: ${nameOrId}`);
    h.exit(2);
  }
  const res = await apiPost(`/api/drives/${d.id}/name`, {
    nickname: nickname?.trim() || null,
  });
  if (!res.ok) {
    const body = (await res.json()) as { error?: string };
    h.errOut(body.error ?? `rename rejected (${res.status})`);
    h.exit(1);
  }
  if (h.jsonMode)
    console.log(
      JSON.stringify({
        command: "rename",
        drive: d.name,
        nickname: nickname?.trim() || null,
      }),
    );
  else h.log(`renamed ${d.name} → ${nickname?.trim() || "(cleared)"}`);
}
