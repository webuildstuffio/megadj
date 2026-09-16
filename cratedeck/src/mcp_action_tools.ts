// mcp_action_tools.ts — the MUTATING half of the deck_* MCP handlers,
// extracted from mcp.ts under the file-length guard (same pattern as
// archive_tools.ts / getdat_tools.ts).
//
// Concern: everything that changes state and therefore carries
// `destructive: true` + the rekordbox interlock guard — job
// enqueue/cancel (run/cancel), the hygiene and fixes action families,
// drive notes (note/dismiss) and rename. Read-only verbs live in
// mcp_read_tools.ts; mcp.ts owns assembly.

import {
  str,
  num,
  RpcParamError,
  obj,
  s,
  sEnum,
  sArr,
  n,
  b,
} from "./mcp_params";
import { apiGetJson, apiPost, PORT, waitForJob, type Job } from "./deckapi";
import { JOB_KINDS } from "../shared/types";
import type { ToolDef } from "./mcp_server";
import { DRIVE_PARAM, needDrive } from "./mcp_read_tools";

// DERIVED from the canonical JobKind union in shared/types.ts (`as const
// satisfies` there type-checks the array against the union) — a kind added
// to the union flows into deck_run's schema or fails the build here. No
// hand-copied twin (the old local list had already dropped `ingest` once).
const RUNNABLE_KINDS = JOB_KINDS;

/** O87 attribution: one id per MCP server process, stamped on mutating calls
 *  so agent actions are distinguishable from human clicks. */
export const MCP_SESSION = `mcp:${crypto.randomUUID().slice(0, 8)}`;

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
  } catch (e) {
    console.error(
      `job ${job.id} has corrupt result_json`,
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

/** Enqueue a job-producing POST (after the interlock guard), optionally
 *  wait for it to finish, and shape the reply. The scan/apply tail of
 *  deck_hygiene and deck_fixes was byte-identical (jscpd-flagged clone);
 *  both tools now delegate here so the wait/timeout/423 contract is
 *  defined once. */
async function runJobAction(
  action: string,
  apiPath: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  await interlockGuard();
  const r = await apiPost(apiPath, { origin: MCP_SESSION });
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
}

/** Mutating deck_* handlers, keyed by CLI verb (mcp.ts derives the deck_*
 *  tool names through deriveDeckTools). Every entry here is destructive;
 *  the interlock guard runs before any enqueue. Typed as a Partial slice
 *  of the full verb record so mcp.ts's spread stays compile-checked. */
export const DECK_ACTION_HANDLERS: Record<string, ToolDef> = {
  run: {
    description:
      "ENQUEUES A DRIVE JOB (mutating): scan (inventory) · verify (deep integrity audit) · mirror (copy master→mirror; writes the mirror) · benchmark (read speed) · checksum (hash ledger). Blocks until done when wait=true. Refuses while rekordbox is running. Mirror only ever writes to the mirror drive.",
    destructive: true,
    inputSchema: obj(
      {
        drive: s("target drive (volume name, nickname, or id)"),
        kind: sEnum([...JOB_KINDS], "job kind (see deck_explain)"),
        wait: b("block until the job finishes (default true)"),
        timeout_minutes: n("wait timeout (default 30)"),
      },
      ["drive", "kind"],
    ),
    run: async (args) => {
      const kind = str(args, "kind") ?? "";
      if (!RUNNABLE_KINDS.includes(kind as (typeof RUNNABLE_KINDS)[number])) {
        throw new RpcParamError(
          `bad kind "${kind}" — one of: ${RUNNABLE_KINDS.join(", ")}`,
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

  cancel: {
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

  hygiene: {
    description:
      "Shelf hygiene queue (docs/getdat/shelf-hygiene-2026-09-09.md): census of duplicate/junk findings on the shelf master. action=scan enqueues a detection job; action=apply executes CONFIRMED findings into the shelf quarantine (never deletes); action=confirm/dismiss decides one finding (required id). Bare call = read-only census.",
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
      return runJobAction(action, `/api/hygiene/${action}`, args);
    },
  },

  fixes: {
    description:
      "Booth compatibility fixes (the checks behind megadj booth-fix, fleet from deck_booth): action=scan enqueues a dry-run audit of the shelf Contents; action=apply executes the SAFE subset (filename renames + tag sanitization — never deletes; `none` rows are proposals only). Bare call = read-only census of the last scan.",
    destructive: true,
    inputSchema: obj(
      {
        action: sEnum(["scan", "apply"]),
        wait: b("block until the job finishes (default true)"),
        timeout_minutes: n("wait timeout (default 30)"),
      },
      [],
    ),
    run: async (args) => {
      const action = str(args, "action");
      if (!action) {
        const r = await apiGetJson("/api/fixes");
        const body = r as { fixable?: number; checked?: number } | null;
        return {
          payload: body,
          note:
            body && body.fixable
              ? "apply executes the safe subset; renames need a rekordbox Relocate Lost Files pass afterwards"
              : "no scan yet or nothing to fix — action=scan audits the shelf",
        };
      }
      return runJobAction(action, `/api/fixes/${action}`, args);
    },
  },

  booth: {
    description:
      "The booth fleet: which Pioneer players the compat gates (megadj audit / booth-fix / ingest) enforce, each with its spec profile and triple citations. ids omitted = read-only show; ids given = SELECT that fleet (persists to config.toml [booth].fleet) — confirm with the human before setting. Empty selection re-applies the default trio.",
    inputSchema: obj({
      ids: sArr(
        "player ids to enforce (xdj-xz, cdj-3000, cdj-2000nxs2, cdj-2000); omit to just show",
      ),
    }),
    run: async (args: Record<string, unknown>) => {
      const raw = args.ids;
      const ids = Array.isArray(raw)
        ? (raw as unknown[]).filter(
            (x: unknown): x is string => typeof x === "string",
          )
        : [];
      if (ids.length === 0) return apiGetJson("/api/booth/fleet");
      const r = await apiPost("/api/booth/fleet", { selected: ids });
      return (await r.json()) as unknown;
    },
  },

  note: {
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

  rename: {
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

  dismiss: {
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
};
