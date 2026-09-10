/**
 * mcp.ts — MCP (Model Context Protocol) server over CrateDeck.
 *
 * The principles say agents get the product 1:1 with humans: this exposes
 * everything deckctl does as MCP tools over stdio JSON-RPC — drive health,
 * fleet coverage, and (with confirmation) job runs; the rekordbox
 * interlock is enforced server-side and mirrored here in the tool layer.
 *
 * Run: bun run cratedeck/src/mcp.ts   (add via your MCP client config)
 * Protocol: MCP 2025-06-18 (JSON-RPC 2.0, newline-delimited over stdio).
 *
 * Tools:
 *   deck_status                 interlock + drives + active jobs
 *   deck_drives                 drive list with badge verdicts
 *   deck_report {drive}         full health dossier (dual-DB, grids, parity…)
 *   deck_coverage {min_copies?} fleet track×drive matrix + at-risk list
 *   deck_redundancy {min_copies?} per-playlist protection audit
 *   deck_diff {a, b}            added/removed/changed between two drives
 *   deck_jobs                   recent jobs
 *   deck_run {drive, kind, wait}  ENQUEUES A JOB — scan|verify|mirror|benchmark|checksum
 *   deck_cancel {job_id}        cancel an active job
 *   deck_explain {kind?}        what each job does, typical duration, safety
 *   deck_preflight              gig-night pass/fail across mounted drives (B12)
 *   deck_players {drive?}       which players can read each stick (N75/N78)
 *   deck_booth {ids?}           the player set compat gates enforce + citations (ids = set)
 *   deck_note {drive, note}     RECORD a finding on a drive timeline (O88)
 *   deck_notes {drive?}         active agent findings (O88, readonly)
 *   deck_rename {drive, nickname?} set/clear the display nickname (mutating)
 *   archive_search_tracks {q}   search the archive (O82b, readonly)
 *   archive_track_stats {video_id}  one track's full archive row
 *   archive_ingest_status       counts + recent runs + newest tracks
 *   archive_lowq_queue          below-bitrate upgrade queue (D24)
 *   archive_source_diff {a, b}  track-set diff between two sources
 *   archive_grid_cross_check    beat_this ledger vs RB BPM×duration verdicts
 *   archive_mood_profile        mood/dance/VA averages + extremes (roadmap #4)
 *   archive_similar_tracks {id, k?}  I49 "sounds like" cosine kNN (readonly)
 *   archive_set_build {preset?, minutes?}  M66 set-builder proposal (readonly)
 *   archive_cue_ledger          8-bar phrase-cue ledger (readonly)
 *   archive_library_overview    FullTags mirror: genres/years/art/energy
 *   archive_skip_census         why gone/skipped rows didn't land
 *   archive_sources             source-tag census (pre-diff lookup)
 *   archive_analysis_coverage   playable vs beats/mood/cues ledgers
 *   deck_prep                   weekly digest markdown (O83, readonly)
 *   deck_search {q}             global search: playlists + folders (B9, readonly)
 *   deck_help {term?}           glossary + job/surface explainers (readonly)
 *   deck_dismiss {drive,note_id} retire an agent note from the active feed (mutating)
 *   archive_sweep               D30 bitrot/truncation sweep (readonly)
 */
import { archiveTools } from "./archive_tools";
import {
  str,
  num,
  RpcParamError,
  obj,
  noArgs,
  s,
  sEnum,
  sArr,
  n,
  b,
  type Prop,
} from "./mcp_params";
import {
  apiGet,
  apiGetJson,
  apiPost,
  ensureServer,
  resolveDrive,
  PORT,
  waitForJob,
  jobTerminal,
  type Job,
} from "./deckapi";
import { KIND_DOCS } from "./deckctl_docs";
import { VERIFY_HELP } from "./verify_help";
import { HELP_TERMS, HELP_JOBS, HELP_SURFACES } from "../shared/help";
import type {
  CoverageResponse,
  JobKind,
  RedundancyResult,
} from "../shared/types";

// re-exported for tests (deckapi's terminal-status predicate)
export { jobTerminal };

// ---- JSON-RPC plumbing ------------------------------------------------------
type JsonRpcId = string | number | null;
interface RpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

function reply(id: JsonRpcId, result: unknown): void {
  // EPIPE-safe: when the client closes the pipe (timeout, disconnect) the
  // server must not crash — an unwritable stdout just means nobody listens.
  try {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
  } catch {
    /* client gone */
  }
}

function replyError(id: JsonRpcId, code: number, message: string): void {
  try {
    process.stdout.write(
      JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n",
    );
  } catch {
    /* client gone */
  }
}

const ERR_PARAMS = -32602;
const ERR_INTERNAL = -32603;

// ---- tool definitions -------------------------------------------------------
interface ToolDef {
  description: string;
  inputSchema: Record<string, unknown>;
  /** readonly tools are safe; mutating ones require explicit user intent. */
  destructive?: boolean;
  run: (args: Record<string, unknown>) => Promise<unknown>;
}

// compile-checked against the canonical JobKind union — adding a job kind
// in shared/types.ts without updating this list is a type error
const JOB_KINDS = [
  "scan",
  "verify",
  "mirror",
  "benchmark",
  "checksum",
  "speedtest",
  "ingest",
  "hygiene-scan",
  "hygiene-apply",
] as const satisfies readonly JobKind[];

/** O87 attribution: one id per MCP server process, stamped on mutating calls
 *  so agent actions are distinguishable from human clicks. */
const MCP_SESSION = `mcp:${crypto.randomUUID().slice(0, 8)}`;

/** The optional `drive` selector shared by every drive-scoped tool schema. */
const DRIVE_PARAM = (omitNote: string): Prop => ({
  type: "string",
  description: `volume name, nickname, or id${omitNote}`,
});

/** Resolve a drive or throw a clean param error. */
async function needDrive(nameOrId: string | undefined): Promise<{
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

async function interlockGuard(): Promise<void> {
  const il = (await apiGetJson("/api/interlock")) as {
    rekordbox_running: boolean;
    pid: number | null;
  };
  if (il.rekordbox_running) {
    throw new Error(
      `rekordbox is running (pid ${il.pid}) — drive operations locked to prevent library corruption. Quit rekordbox and retry.`,
    );
  }
}

async function jobResult(job: Job): Promise<unknown> {
  if (!job.result_json) return null;
  try {
    return JSON.parse(job.result_json);
  } catch {
    return null;
  }
}

const TOOLS: Record<string, ToolDef> = {
  deck_status: {
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

  deck_drives: {
    description:
      "List all known DJ USB drives with health badges (mounted, last verify, space).",
    inputSchema: noArgs(),
    run: async () => apiGetJson("/api/drives"),
  },

  deck_report: {
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

  deck_coverage: {
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

  deck_redundancy: {
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

  deck_diff: {
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

  deck_jobs: {
    description: "Recent CrateDeck jobs with status/progress.",
    inputSchema: noArgs(),
    run: async () => apiGetJson("/api/jobs"),
  },

  deck_run: {
    description:
      "ENQUEUES A DRIVE JOB (mutating): scan (inventory) · verify (deep integrity audit) · mirror (copy master→mirror; writes the mirror) · benchmark (read speed) · checksum (hash ledger). Blocks until done when wait=true. Refuses while rekordbox is running. Mirror only ever writes to the mirror drive.",
    destructive: true,
    inputSchema: obj(
      {
        drive: s("target drive (volume name, nickname, or id)"),
        kind: sEnum([...JOB_KINDS]),
        wait: b("block until the job finishes (default true)"),
        timeout_minutes: n("wait timeout (default 30)"),
      },
      ["drive", "kind"],
    ),
    run: async (args) => {
      const kind = str(args, "kind") ?? "";
      if (!JOB_KINDS.includes(kind as (typeof JOB_KINDS)[number])) {
        throw new RpcParamError(
          `bad kind "${kind}" — one of: ${JOB_KINDS.join(", ")}`,
        );
      }
      const d = await needDrive(str(args, "drive"));
      if (!d.mounted)
        throw new RpcParamError(
          `drive ${d.nickname ?? d.name} is not mounted — plug it in first`,
        );
      await interlockGuard();
      // O87 attribution: agent-initiated jobs carry the MCP session so the
      // timeline answers "why did this verify run at 3am" ("mcp:<session>")
      const res = await apiPost(`/api/drives/${d.id}/jobs`, {
        kind,
        origin: `mcp:${MCP_SESSION}`,
      });
      // server re-checks the interlock at enqueue (TOCTOU guard); map its
      // 423 to the same clean param-style message our own guard throws
      if (res.status === 423) {
        throw new RpcParamError(
          "rekordbox started mid-request — drive operations locked. Quit rekordbox and retry.",
        );
      }
      const body = (await res.json()) as Job & { error?: string };
      if (!res.ok) {
        throw new Error(body.error ?? `enqueue failed (${res.status})`);
      }
      const wait = args["wait"] !== false;
      if (!wait) return { job: body, drive: d.name, kind, status: body.status };
      const timeoutMs = (num(args, "timeout_minutes") ?? 30) * 60 * 1000;
      const final = await waitForJob(body.id, { timeoutMs });
      return {
        job: { ...final, result: await jobResult(final) },
        drive: d.name,
        kind,
        ok: final.status === "done",
      };
    },
  },

  deck_cancel: {
    description: "Cancel an active job by id.",
    destructive: true,
    inputSchema: obj({ job_id: s("") }, ["job_id"]),
    run: async (args) => {
      const jobId = str(args, "job_id");
      if (!jobId) throw new RpcParamError("job_id is required");
      const r = await apiPost(`/api/jobs/${jobId}/cancel`);
      return (await r.json()) as unknown;
    },
  },

  deck_hygiene: {
    description:
      "Shelf hygiene queue (docs/shelf-hygiene-2026-09-09.md): census of duplicate/junk findings on the shelf master. action=scan enqueues a detection job; action=apply executes CONFIRMED findings into the shelf quarantine (never deletes); action=confirm/dismiss decides one finding (required id). Bare call = read-only census.",
    destructive: true,
    inputSchema: obj(
      {
        action: sEnum(["scan", "apply", "confirm", "dismiss"]),
        id: s("finding id (required for confirm/dismiss)"),
        wait: b("block until a scan/apply job finishes (default true)"),
        timeout_minutes: n("wait timeout (default 30)"),
      },
      [],
    ),
    run: async (args) => {
      const action = str(args, "action");
      if (!action) {
        const r = await apiGetJson("/api/hygiene");
        return {
          counts: (r as { counts: unknown }).counts,
          note: "confirm before apply — apply moves confirmed losers to quarantine (recoverable)",
        };
      }
      if (action === "confirm" || action === "dismiss") {
        const id = str(args, "id");
        if (!id)
          throw new RpcParamError(`action "${action}" requires a finding id`);
        await interlockGuard();
        const r = await apiPost("/api/hygiene/decide", {
          id,
          confirm: action === "confirm",
          origin: `mcp:${MCP_SESSION}`,
        });
        const body = (await r.json()) as { ok?: boolean; error?: string };
        if (!r.ok || !body.ok)
          throw new Error(body.error ?? `decide failed (${r.status})`);
        return { ok: true, id, action };
      }
      // scan | apply — enqueue + optionally wait (same shape as deck_run)
      await interlockGuard();
      const r = await apiPost(`/api/hygiene/${action}`, {
        origin: `mcp:${MCP_SESSION}`,
      });
      if (r.status === 423)
        throw new RpcParamError(
          "rekordbox started mid-request — drive operations locked. Quit rekordbox and retry.",
        );
      const body = (await r.json()) as Job & { error?: string };
      if (!r.ok) throw new Error(body.error ?? `enqueue failed (${r.status})`);
      const wait = args["wait"] !== false;
      if (!wait) return { job: body, action, status: body.status };
      const timeoutMs = (num(args, "timeout_minutes") ?? 30) * 60 * 1000;
      const final = await waitForJob(body.id, { timeoutMs });
      return {
        job: { ...final, result: await jobResult(final) },
        action,
        ok: final.status === "done",
      };
    },
  },

  deck_explain: {
    description:
      "Documentation as a tool: what each job type checks, typical duration, and safety guarantees. Kind omitted = all jobs.",
    inputSchema: obj({
      kind: sEnum([
        "scan",
        "verify",
        "mirror",
        "benchmark",
        "checksum",
        "hygiene-scan",
        "hygiene-apply",
      ]),
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
      return (
        d ?? {
          error: `unknown kind "${kind}" — one of: verify, ${Object.keys(KIND_DOCS).join(", ")}`,
        }
      );
    },
  },

  deck_preflight: {
    description:
      "B12 gig-night gate: aggregated pass/fail checklist over every mounted drive (dual-DB currency, grids, last verify, read speed, bitrot, space, mirror parity). Verdict is ready / attention / not-ready / unknown with per-check fixes. Read-only.",
    inputSchema: noArgs(),
    run: async () => apiGetJson("/api/preflight"),
  },

  deck_players: {
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

  deck_booth: {
    description:
      "The booth fleet: which Pioneer players the compat gates (megadj audit / booth-fix / ingest) enforce, each with its spec profile and triple citations. ids omitted = read-only show; ids given = SELECT that fleet (persists to config.toml [booth].fleet) — confirm with the human before setting. Empty selection re-applies the default trio.",
    inputSchema: obj({
      ids: sArr(
        "player ids to enforce (xdj-xz, cdj-3000, cdj-2000nxs2, cdj-2000); omit to just show",
      ),
    }),
    run: async (args) => {
      const raw = (args as { ids?: unknown }).ids;
      const ids = Array.isArray(raw)
        ? (raw as unknown[]).filter((x): x is string => typeof x === "string")
        : [];
      if (ids.length === 0) return apiGetJson("/api/booth/fleet");
      const r = await apiPost("/api/booth/fleet", { selected: ids });
      return (await r.json()) as unknown;
    },
  },

  deck_note: {
    description:
      "RECORDS A FINDING ON A DRIVE'S TIMELINE (mutating, human-visible): land a conclusion an agent reached about a drive (e.g. 'firmware 3.30 has the playlist-vanishing bug — stay on 3.22'). The note shows as a dismissable card on the drive page. Max 600 chars. Confirm with the human before calling.",
    destructive: true,
    inputSchema: obj(
      {
        drive: s("volume name, nickname, or id"),
        note: s("the finding (max 600 chars)"),
        severity: sEnum(
          ["info", "warn", "critical"],
          "card tone (default info)",
        ),
      },
      ["drive", "note"],
    ),
    run: async (args) => {
      const drive = str(args, "drive");
      const note = str(args, "note");
      if (!drive) throw new RpcParamError("drive is required");
      if (!note) throw new RpcParamError("note is required");
      const d = await needDrive(drive);
      const severity = str(args, "severity");
      const res = await apiPost(`/api/drives/${d.id}/notes`, {
        note,
        origin: MCP_SESSION,
        severity:
          severity === "warn" || severity === "critical" ? severity : "info",
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new RpcParamError(body.error ?? `note rejected (${res.status})`);
      }
      return {
        ok: true,
        drive: d.nickname ?? d.name,
        note,
        visible_at: `http://127.0.0.1:${PORT}/drives/${d.id}`,
      };
    },
  },

  deck_rename: {
    description:
      "RENAMES A DRIVE (mutating): set or clear the display nickname shown across the UI, deckctl, and MCP. Pass an empty string or omit nickname to clear. Confirm with the human before calling — this is a human-facing label.",
    destructive: true,
    inputSchema: obj(
      {
        drive: s("volume name, nickname, or id"),
        nickname: s("new display name (empty/omitted = clear)"),
      },
      ["drive"],
    ),
    run: async (args) => {
      const d = await needDrive(str(args, "drive"));
      const nickname = str(args, "nickname")?.trim() || null;
      const res = await apiPost(`/api/drives/${d.id}/name`, { nickname });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new RpcParamError(
          body.error ?? `rename rejected (${res.status})`,
        );
      }
      return { ok: true, drive: d.name, nickname };
    },
  },

  deck_notes: {
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

  deck_prep: {
    description:
      "O83 weekly digest as a tool: renders the markdown gig-readiness digest (preflight verdicts → redundancy gaps → archive status + LOWQ queue) from the same reads `deckctl prep` uses. Read-only — it renders; it never writes.",
    inputSchema: noArgs(),
    run: async () => {
      // same fetch-and-render seam as deckctl cmdPrep (one implementation,
      // two spokes — surface-parity.md GAP-2 closed)
      const { fetchWeeklyPrepInput, renderWeeklyPrep } =
        await import("./weekly_prep");
      const getJson = <T>(path: string, timeoutMs?: number) =>
        apiGet(path, timeoutMs).then((r) => r.json() as Promise<T>);
      const input = await fetchWeeklyPrepInput(getJson);
      return { markdown: renderWeeklyPrep(input) };
    },
  },

  deck_search: {
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

  deck_help: {
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

  deck_dismiss: {
    description:
      "DISMISSES AN AGENT NOTE (mutating, confirm with the human): removes a finding from the active notes feed once it's handled — history is kept, the timeline card stays but reads as dismissed. Pass the note id exactly as returned by deck_note / deck_notes. Only agent notes can be dismissed.",
    destructive: true,
    inputSchema: obj(
      {
        drive: DRIVE_PARAM(""),
        note_id: s("the note id from deck_note/deck_notes (row id)"),
      },
      ["drive", "note_id"],
    ),
    run: async (args) => {
      const d = await needDrive(str(args, "drive"));
      const noteId = str(args, "note_id");
      if (!noteId) throw new RpcParamError("note_id is required");
      const res = await apiPost(
        `/api/drives/${d.id}/notes/${encodeURIComponent(noteId)}/dismiss`,
      );
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok)
        throw new RpcParamError(body.error ?? `dismiss failed (${res.status})`);
      return { ok: true, drive: d.nickname ?? d.name, id: noteId };
    },
  },

  // ---- O82b: the archive half (megadj's own DB, readonly) -------------------
  ...archiveTools(),
};

// ---- server loop ------------------------------------------------------------
async function handle(req: RpcRequest): Promise<void> {
  const id = req.id ?? null;
  try {
    switch (req.method) {
      case "initialize":
        reply(id, {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: {
            name: "cratedeck",
            title: "CrateDeck",
            version: "0.1.0",
          },
        });
        return;
      case "notifications/initialized":
        return; // notification — no response
      case "ping":
        reply(id, {});
        return;
      case "tools/list":
        reply(id, {
          tools: Object.entries(TOOLS).map(([name, t]) => ({
            name,
            description:
              t.description + (t.destructive ? " [MUTATES DRIVE STATE]" : ""),
            inputSchema: t.inputSchema,
            annotations: {
              title: name.replace(/^deck_/, "CrateDeck ").replace(/_/g, " "),
              readOnlyHint:
                !t.destructive && name !== "deck_run" && name !== "deck_cancel",
            },
          })),
        });
        return;
      case "tools/call": {
        const name = str(req.params ?? {}, "name");
        if (!name || !TOOLS[name]) {
          replyError(id, ERR_PARAMS, `unknown tool: ${name}`);
          return;
        }
        // MCP spec: params key is "arguments" (not "args") — reading the
        // wrong key silently dropped every argument from conforming clients.
        const args =
          ((req.params ?? {})["arguments"] as
            Record<string, unknown> | undefined) ?? {};
        const raw = await TOOLS[name].run(args);
        const text = JSON.stringify(raw, null, 2);
        reply(id, {
          content: [{ type: "text", text }],
          isError: false,
        });
        return;
      }
      default:
        replyError(id, -32601, `method not found: ${req.method}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    replyError(id, e instanceof RpcParamError ? ERR_PARAMS : ERR_INTERNAL, msg);
  }
}

async function main(): Promise<void> {
  // Refuse to serve if the backend never comes up — but answer initialize
  // first so clients surface a clean error instead of hanging.
  const up = await ensureServer();
  const reader = Bun.stdin.stream().getReader();
  const dec = new TextDecoder();
  let buf = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let req: RpcRequest;
      try {
        req = JSON.parse(line) as RpcRequest;
      } catch {
        replyError(null, -32700, "parse error");
        continue;
      }
      if (!up && req.method !== "initialize" && req.method !== "ping") {
        if (req.id !== undefined && req.id !== null) {
          replyError(req.id, ERR_INTERNAL, "cratedeck server unreachable");
        }
        // notifications stay silent even when the backend is down
        continue;
      }
      // JSON-RPC 2.0: a message without an id is a notification — MUST NOT
      // be answered (a stray id:null error can be mis-associated by
      // strict clients).
      if (req.id === undefined || req.id === null) {
        if (!req.method.startsWith("notifications/")) {
          console.error(`mcp: ignoring id-less ${req.method}`);
        }
        continue;
      }
      // Not awaited: a long tool call (deck_run with wait) must not stall
      // the pipe — subsequent requests stay answerable. Replies are
      // single-line stdout writes, so ordering interleaving is safe. Write
      // failure is logged: a silently-dead reply strands the caller until
      // its client timeout with zero diagnostics.
      void handle(req).catch((e: unknown) => {
        console.error(`mcp: request ${req.method} failed`, e);
      });
    }
  }
}

await main();
