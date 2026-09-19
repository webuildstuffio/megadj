// mcp_read_tools.ts — the READ-ONLY half of the deck_* MCP handlers,
// extracted from mcp.ts under the file-length guard (same pattern as
// archive_tools.ts / getdat_tools.ts).
//
// Concern: everything an agent may call without a confirmation gate —
// status, drive listing/report, fleet coverage/redundancy/diff, job list,
// explain/preflight/players/booth(read)/notes/search/help/prep. Mutating
// verbs (run/cancel/note/rename/dismiss) and the action families
// (hygiene/fixes) stay in mcp_action_tools.ts; mcp.ts owns assembly.

import {
  str,
  num,
  RpcParamError,
  obj,
  noArgs,
  s,
  sEnum,
  n,
  type Prop,
} from "./mcp-params";
import { apiGetJson, apiGetJsonT, resolveDrive } from "./deckapi";
import { KIND_DOCS } from "./deckctl-docs";
import { VERIFY_HELP } from "./verify-help";
import { HELP_TERMS, HELP_JOBS, HELP_SURFACES } from "../shared/help";
import type { CoverageResponse, RedundancyResult } from "../shared/types";
import type { ToolDef } from "./mcp-server";

/** The optional `drive` selector shared by every drive-scoped tool schema. */
export const DRIVE_PARAM = (omitNote: string): Prop => ({
  type: "string",
  description: `volume name, nickname, or id${omitNote}`,
});

/** Resolve a drive or throw a clean param error. Shared by both halves. */
export async function needDrive(nameOrId: string | undefined): Promise<{
  id: string;
  name: string;
  nickname: string | null;
  mounted: boolean;
}> {
  if (!nameOrId)
    throw new RpcParamError("drive is required (volume name, nickname, or id)");
  const d = await resolveDrive(nameOrId);
  if (!d) throw new RpcParamError(`unknown drive: ${nameOrId}`);
  return d;
}

/** Read-only deck_* handlers, keyed by CLI verb (mcp.ts derives the
 *  deck_* tool names through deriveDeckTools). Typed as a Partial slice
 *  of the full verb record so mcp.ts's spread stays compile-checked. */
export const DECK_READ_HANDLERS: Record<string, ToolDef> = {
  status: {
    description:
      "CrateDeck overview: rekordbox interlock state, every known drive with badge verdicts, and active jobs. Call this first.",
    inputSchema: noArgs(),
    run: async () => {
      const [interlock, drives, jobs] = await Promise.all([
        apiGetJson("/api/interlock"),
        apiGetJson("/api/drives"),
        apiGetJson("/api/jobs?active=1"),
      ]);
      return { interlock, drives, jobs };
    },
  },

  drives: {
    description:
      "List all known DJ USB drives with health badges (mounted, last verify, space).",
    inputSchema: noArgs(),
    run: async () => apiGetJson("/api/drives"),
  },

  report: {
    description:
      "Full health dossier for one drive: dual-DB hardware gate, beatgrid coverage, bitrot (checksum ledger), space, mirror parity — with an overall verdict. format=dossier returns the export bundle (drive + snapshot + sync + report + timeline + benchmarks). Drive = volume name, nickname, or id.",
    inputSchema: obj(
      {
        drive: s("volume name, nickname, or drive id"),
        format: sEnum(
          ["report", "dossier"],
          "report (default) = health checks; dossier = full export bundle",
        ),
      },
      ["drive"],
    ),
    run: async (args) => {
      const d = await needDrive(str(args, "drive"));
      if (str(args, "format") === "dossier")
        return apiGetJson(`/api/drives/${d.id}/export`);
      return apiGetJson(`/api/drives/${d.id}/report`);
    },
  },

  coverage: {
    description:
      "Fleet coverage: which tracks live on which drives, plus the at-risk list (tracks below the redundancy floor).",
    inputSchema: obj({
      min_copies: n("redundancy floor (default: server default, usually 2)"),
    }),
    run: async (args) => {
      const nCopies = num(args, "min_copies");
      const qs = nCopies && nCopies > 0 ? `?min_copies=${nCopies}` : "";
      return apiGetJson(
        `/api/fleet/coverage${qs}`,
      ) as Promise<CoverageResponse>;
    },
  },

  redundancy: {
    description:
      "Per-playlist redundancy audit: is every track in each playlist present on enough drives? Returns pass/warn/fail per playlist with gap lists.",
    inputSchema: obj({ min_copies: n() }),
    run: async (args) => {
      const nCopies = num(args, "min_copies");
      const qs = nCopies && nCopies > 0 ? `?min_copies=${nCopies}` : "";
      return apiGetJson(
        `/api/fleet/redundancy${qs}`,
      ) as Promise<RedundancyResult>;
    },
  },

  diff: {
    description:
      "Compare two drives: tracks added, missing, or byte-changed between them.",
    inputSchema: obj(
      {
        a: s("first drive (volume name, nickname, or id)"),
        b: s("second drive"),
      },
      ["a", "b"],
    ),
    run: async (args) => {
      const da = await needDrive(str(args, "a"));
      const dbb = await needDrive(str(args, "b"));
      return apiGetJson(
        `/api/fleet/diff?a=${encodeURIComponent(da.id)}&b=${encodeURIComponent(dbb.id)}`,
      );
    },
  },

  radar: {
    description:
      "New-music radar (#148): archived tracks NOT yet on each drive — the pre-sync delta between megadj's archive ledger and every drive's latest scan snapshot. Per-drive counts come from the full comparison (COUNT truth); preview lists are capped. Each row carries its snapshot's age — a never-scanned drive reads as unknown, not current. Read-only: the fix is the copyable `megadj shelf-sync` command, never an automatic write.",
    inputSchema: obj({
      drive: s("optional: one drive (volume name, nickname, or id) to focus"),
    }),
    run: async (args) => {
      const name = str(args, "drive");
      if (!name) return apiGetJson("/api/fleet/radar");
      const d = await needDrive(name);
      const all = (await apiGetJson("/api/fleet/radar")) as {
        drives: { driveId: string }[];
      };
      return { ...all, drives: all.drives.filter((r) => r.driveId === d.id) };
    },
  },

  jobs: {
    description: "Recent CrateDeck jobs with status/progress.",
    inputSchema: noArgs(),
    run: async () => apiGetJson("/api/jobs"),
  },

  explain: {
    description:
      "Documentation as a tool: what each job type checks, typical duration, and safety guarantees. Kind omitted = all jobs.",
    inputSchema: obj({
      // Derived from the KIND_DOCS keys + verify (which rides VERIFY_HELP's
      // richer doc). JobKind values with no docs entry must NOT appear in
      // the schema — that's the census test's contract (kind-docs.test.ts):
      // when KIND_DOCS gains `ingest` it flows in here automatically, and
      // a doc-less kind fails the build instead of lying in the schema.
      kind: sEnum(
        ["verify", ...Object.keys(KIND_DOCS)],
        "job kind (omit for every kind's docs)",
      ),
    }),
    run: async (args) => {
      // Derived from the KIND_DOCS SSOT (deckctl_docs.ts) — same words as
      // `deckctl explain`, no hand-maintained twin to drift.
      const kind = str(args, "kind");
      if (!kind) {
        return { verify: VERIFY_HELP, ...KIND_DOCS };
      }
      if (kind === "verify") return { verify: VERIFY_HELP };
      const d = KIND_DOCS[kind];
      if (!d)
        throw new RpcParamError(
          `unknown kind "${kind}" — one of: verify, ${Object.keys(KIND_DOCS).join(", ")}`,
        );
      return d;
    },
  },

  preflight: {
    description:
      "B12 gig-night gate: aggregated pass/fail checklist over every mounted drive (dual-DB currency, grids, last verify, read speed, bitrot, space, mirror parity). Verdict is ready / attention / not-ready / unknown with per-check fixes. Read-only.",
    inputSchema: noArgs(),
    run: async () => apiGetJson("/api/preflight"),
  },

  players: {
    description:
      "N78 hardware compatibility: which Pioneer players (XDJ-XZ, CDJ-3000, XDJ-AZ, OPUS-QUAD…) can actually read a drive, derived from its MEASURED dual-DB state. Drive omitted = every known drive. Read-only.",
    inputSchema: obj({ drive: DRIVE_PARAM(" (omit for all drives)") }),
    run: async (args) => {
      const drive = str(args, "drive");
      if (!drive) return apiGetJson("/api/drives");
      const d = await needDrive(drive);
      return apiGetJson(`/api/drives/${d.id}/players`);
    },
  },

  notes: {
    description:
      "Active agent findings for a drive (or all drives): notes landed via deck_note that a human has not dismissed. Read-only.",
    inputSchema: obj({ drive: DRIVE_PARAM(" (omit for all drives)") }),
    run: async (args) => {
      const drive = str(args, "drive");
      if (!drive) {
        const drives = await apiGetJson("/api/drives");
        const out = [];
        for (const d of drives as { id: string; name: string }[]) {
          try {
            const notes = await apiGetJson(`/api/drives/${d.id}/notes`);
            if (Array.isArray(notes) && notes.length)
              out.push({ drive: d.name, notes });
          } catch {
            /* drive gone mid-loop */
          }
        }
        return out;
      }
      const d = await needDrive(drive);
      return apiGetJson(`/api/drives/${d.id}/notes`);
    },
  },

  prep: {
    description:
      "O83 weekly digest as a tool: renders the markdown gig-readiness digest (preflight verdicts → redundancy gaps → archive status + LOWQ queue) from the same reads `deckctl prep` uses. Read-only — it renders; it never writes.",
    inputSchema: noArgs(),
    run: async () => {
      // same fetch-and-render seam as deckctl cmdPrep (one implementation,
      // two spokes — surface-parity.md GAP-2 closed)
      const { fetchWeeklyPrepInput, renderWeeklyPrep } =
        await import("./weekly-prep");
      const input = await fetchWeeklyPrepInput(apiGetJsonT);
      return { markdown: renderWeeklyPrep(input) };
    },
  },

  search: {
    description:
      "B9 global search (the UI's ⌘K): case-insensitive substring match over playlists and folders in every drive snapshot. Returns per-drive match lists. Read-only.",
    inputSchema: obj(
      { q: s("search text (playlist or folder name substring)") },
      ["q"],
    ),
    run: async (args) => {
      const q = str(args, "q")?.trim();
      if (!q) throw new RpcParamError("q is required");
      return apiGetJson(`/api/search?q=${encodeURIComponent(q)}`);
    },
  },

  help: {
    description:
      "CrateDeck's in-app help as a tool: the glossary (Master, Mirror, Ghost, Interlock, Dual-DB, Beatgrid, Bitrot, Preflight, Redundancy, Dossier, LOWQ, Snapshot), the five job explainers (what/when/safety/duration), and the UI surface tour. Call with term= a glossary word or job kind for one entry; omit it for everything. Read-only — use this to answer 'what does X mean' before acting.",
    inputSchema: obj({
      term: s(
        "optional glossary term or job kind (e.g. 'ghost', 'verify') for a single entry",
      ),
    }),
    run: async (args) => {
      const topic = str(args, "term")?.trim().toLowerCase();
      if (topic) {
        // job kinds are canonical ids and win over same-named glossary
        // terms (deck_help{term:"mirror"} = the mirror JOB, not the word)
        const job = HELP_JOBS.find((x) => x.kind === topic);
        const term = job
          ? undefined
          : (HELP_TERMS.find((x) => x.term.toLowerCase() === topic) ??
            HELP_TERMS.find((x) => x.term.toLowerCase().startsWith(topic)));
        if (term) return { term };
        if (job) return { job };
        throw new RpcParamError(
          `no help entry for "${topic}" — glossary terms: ${HELP_TERMS.map((x) => x.term).join(", ")}; job kinds: ${HELP_JOBS.map((x) => x.kind).join(", ")}`,
        );
      }
      return { terms: HELP_TERMS, jobs: HELP_JOBS, surfaces: HELP_SURFACES };
    },
  },
};
