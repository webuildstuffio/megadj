// megaset-draft.ts — the MegaSet draft download (#209 split from
// MegasetPanel.tsx): pure payload→file logic, no component state. No API
// call and no library mutation: the browser downloads exactly the measured
// result on screen.
//
// Sep 21 hardening (owner rule: dated artifacts): the filename carries the
// build date, and the saved JSON carries the REQUEST context (genre,
// search, pool cap, opener + the exact CLI repro line) so a draft is
// self-describing months later — the old file could not answer "what
// settings produced this?".
import type { MegasetPayload } from "../../../shared/types";
import { toast } from "../../ui/toast";

/** The exact terminal invocation for this build — kept in sync with the
 *  on-screen repro line's parameter set (preset/minutes always; the knobs
 *  only when non-default). Local to the draft so the saved file stays
 *  reproducible without the page. */
export function megasetReproCommand(
  data: MegasetPayload,
  knobs: {
    searchChoice: "auto" | "greedy" | "beam";
    poolLimit: number | null;
    openerId: string | null;
    genre: string | null;
  },
): string {
  const parts = [
    "megadj megaset",
    `--preset ${data.preset}`,
    `--minutes ${data.minutes}`,
  ];
  if (knobs.searchChoice !== "auto")
    parts.push(`--search ${knobs.searchChoice}`);
  if (knobs.poolLimit !== null) parts.push(`--limit ${knobs.poolLimit}`);
  if (knobs.openerId) parts.push(`--opener ${knobs.openerId}`);
  if (knobs.genre !== null && knobs.genre.trim() !== "")
    parts.push(`--genre ${knobs.genre.trim()}`);
  return parts.join(" ");
}

export function saveDraft(
  data: MegasetPayload,
  knobs: {
    searchChoice: "auto" | "greedy" | "beam";
    poolLimit: number | null;
    openerId: string | null;
    genre: string | null;
  } = {
    searchChoice: "auto",
    poolLimit: null,
    openerId: null,
    genre: null,
  },
): void {
  const blob = new Blob(
    [
      JSON.stringify(
        {
          kind: "megadj-set-draft",
          savedAt: new Date().toISOString(),
          status: data.complete ? "complete" : "partial",
          // request context — a draft must answer "what built this?"
          request: {
            preset: data.preset,
            minutes: data.minutes,
            search: data.search,
            poolLimit: knobs.poolLimit,
            openerId: knobs.openerId,
            genre:
              knobs.genre !== null && knobs.genre.trim() !== ""
                ? knobs.genre.trim()
                : null,
            // the one-line terminal repro (same knobs the screen shows)
            repro: megasetReproCommand(data, knobs),
          },
          ...data,
        },
        null,
        2,
      ),
    ],
    { type: "application/json" },
  );
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  // dated filename (owner rule): set-peak-60min-2026-09-21-draft.json
  anchor.download = `set-${data.preset}-${data.actualMinutes}min-${new Date()
    .toISOString()
    .slice(0, 10)}-${data.complete ? "draft" : "partial"}.json`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
  toast(
    data.complete ? "MegaSet draft saved" : "Partial set draft saved",
    "ok",
  );
}
