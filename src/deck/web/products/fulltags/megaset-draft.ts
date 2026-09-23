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
import { isRecord, parseJsonOrNull } from "../../../../shared/leaf/guards";
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
    landmarkIds: readonly string[];
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
  // S13 (#107): pins ride the repro so the saved draft rebuilds identical
  for (const id of knobs.landmarkIds) parts.push(`--landmark ${id}`);
  return parts.join(" ");
}

export function saveDraft(
  data: MegasetPayload,
  knobs: {
    searchChoice: "auto" | "greedy" | "beam";
    poolLimit: number | null;
    openerId: string | null;
    genre: string | null;
    landmarkIds: readonly string[];
  } = {
    searchChoice: "auto",
    poolLimit: null,
    openerId: null,
    genre: null,
    landmarkIds: [],
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
            // S13 (#107): the pins this build was asked to include
            landmarkIds: [...knobs.landmarkIds],
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

/** #293: the knobs a saved draft can restore into the builder controls.
 *  Derived from the draft's `request{}` block (Sep 21+ format); older
 *  drafts degrade to what their payload fields still carry (preset +
 *  minutes + search were always on the wire). */
export interface MegasetDraftKnobs {
  preset: string;
  minutes: number;
  search: "auto" | "greedy" | "beam";
  poolLimit: number | null;
  openerId: string | null;
  genre: string | null;
  landmarkIds: string[];
}

/** #293: parse a saved draft file's text into restorable knobs. Returns
 *  an error string for anything that is not a megadj set draft (never
 *  throws — a wrong file is a message, not a crash). Old-format drafts
 *  (pre-`request{}`) restore preset/minutes/search and leave the knobs
 *  they cannot know untouched. */
export function parseDraft(
  text: string,
): { ok: true; knobs: MegasetDraftKnobs } | { ok: false; error: string } {
  // #274 rule: boundary JSON goes through the guarded parser seam — a
  // malformed draft file is an error MESSAGE, never a throw.
  const parsed = parseJsonOrNull(text);
  if (parsed === null)
    return { ok: false, error: "not valid JSON — is this the draft file?" };
  if (parsed.kind !== undefined && parsed.kind !== "megadj-set-draft")
    return { ok: false, error: `wrong file kind: ${String(parsed.kind)}` };
  // preset: request{} first, payload fallback; must be a non-empty string
  const request = isRecord(parsed.request) ? parsed.request : null;
  const preset = request?.preset ?? parsed.preset;
  if (typeof preset !== "string" || preset.trim() === "")
    return { ok: false, error: "draft has no preset to restore" };
  const minutes = request?.minutes ?? parsed.minutes;
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0)
    return { ok: false, error: "draft has no usable minutes value" };
  const search =
    request?.search === "greedy" || request?.search === "beam"
      ? request.search
      : "auto";
  const poolLimit =
    typeof request?.poolLimit === "number" &&
    Number.isFinite(request.poolLimit) &&
    request.poolLimit > 0
      ? request.poolLimit
      : null;
  const openerId =
    typeof request?.openerId === "string" && request.openerId.trim() !== ""
      ? request.openerId.trim()
      : null;
  const genre =
    typeof request?.genre === "string" && request.genre.trim() !== ""
      ? request.genre.trim()
      : null;
  const landmarkIds = Array.isArray(request?.landmarkIds)
    ? request.landmarkIds.filter(
        (id): id is string => typeof id === "string" && id.trim() !== "",
      )
    : [];
  return {
    ok: true,
    knobs: {
      preset: preset.trim(),
      minutes,
      search,
      poolLimit,
      openerId,
      genre,
      landmarkIds,
    },
  };
}
