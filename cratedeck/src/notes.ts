// notes.ts — O88: the findings-from-agents feed.
//
// The MCP surface makes agents natural READERS of fleet health (O82/O82b);
// this makes their conclusions first-class. A tiny, explicitly-mutating
// `deck_note` tool lands an agent's finding in the drive timeline as a
// dismissable event — "agent flagged this drive's firmware" becomes a card
// on the drive page instead of chat scrollback.
//
// Safety rails (O86, mirrored here): deck_note is annotation-flagged
// `readOnlyHint: false` + described [WRITES TO TIMELINE]; the server
// validates + clamps everything; notes are events, so the 2000-per-drive
// disk-burn cap applies — no unbounded growth.
import { randomUUID } from "node:crypto";

/** Longest note body accepted (chars). Agents ramble; the card shouldn't. */
export const NOTE_MAX = 600;
/** Longest attribution tag. */
export const ORIGIN_MAX = 40;

export interface NoteInput {
  drive_id: string;
  note: string;
  /** Who wrote it — "mcp:<session>" or an agent's display name. */
  origin?: string;
  /** Optional severity, rendered as the card tone. Default "info". */
  severity?: "info" | "warn" | "critical";
}

export interface StoredNote {
  id: string;
  drive_id: string;
  note: string;
  origin: string;
  severity: "info" | "warn" | "critical";
  at: number;
  /** Set when dismissed; dismissed notes leave the active feed. */
  dismissed_at: number | null;
}

/** Validate + clamp a note. Throws RpcParamError-style Error on garbage —
 *  the caller maps it to a clean tool error. Returns the normalized fields. */
export function normalizeNote(
  input: NoteInput,
): {
  drive_id: string;
  note: string;
  origin: string;
  severity: "info" | "warn" | "critical";
} {
  const drive = input.drive_id?.trim();
  if (!drive) throw new Error("drive_id is required");
  const text = input.note?.trim();
  if (!text) throw new Error("note is required");
  if (text.length > NOTE_MAX)
    throw new Error(`note too long (max ${NOTE_MAX} chars, got ${text.length})`);
  const origin = (input.origin ?? "mcp").trim().slice(0, ORIGIN_MAX) || "mcp";
  const severity =
    input.severity === "warn" || input.severity === "critical"
      ? input.severity
      : "info";
  return { drive_id: drive, note: text, origin, severity };
}

/** Timeline event shape for a stored note (kind "agent-note"). */
export function noteEvent(note: StoredNote): {
  id: string;
  drive_id: string;
  at: number;
  kind: "agent-note";
  data: Record<string, unknown>;
} {
  return {
    id: note.id,
    drive_id: note.drive_id,
    at: note.at,
    kind: "agent-note" as const,
    data: {
      note: note.note,
      origin: note.origin,
      severity: note.severity,
      dismissed_at: note.dismissed_at,
    },
  };
}

/** Parse the stored event data back into a note (timeline rendering). */
export function noteFromEvent(row: {
  id: string;
  drive_id: string;
  at: number;
  kind: string;
  data: Record<string, unknown>;
}): StoredNote | null {
  if (row.kind !== "agent-note") return null;
  const text = typeof row.data["note"] === "string" ? row.data["note"] : null;
  if (!text) return null;
  return {
    id: row.id,
    drive_id: row.drive_id,
    note: text,
    origin:
      typeof row.data["origin"] === "string" ? row.data["origin"] : "mcp",
    severity:
      row.data["severity"] === "warn" || row.data["severity"] === "critical"
        ? row.data["severity"]
        : "info",
    at: row.at,
    dismissed_at:
      typeof row.data["dismissed_at"] === "number"
        ? (row.data["dismissed_at"] as number)
        : null,
  };
}

export function newNoteId(): string {
  return randomUUID();
}

// ---- store operations -------------------------------------------------------
// Notes live in the events table (kind "agent-note"); these helpers take a
// structural slice of the DB class so notes.ts owns ALL note logic without a
// db → notes → db import cycle.

interface NoteEventRow {
  id: string;
  drive_id: string;
  at: number;
  kind: string;
  data_json: string;
}

function parseNoteRow(row: NoteEventRow): StoredNote | null {
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(row.data_json) as Record<string, unknown>;
  } catch {
    return null;
  }
  return noteFromEvent({
    id: row.id,
    drive_id: row.drive_id,
    at: row.at,
    kind: row.kind,
    data,
  });
}

/** The slice of DB the note store needs: the event() writer plus the raw
 *  sqlite handle (readonly public field on DB). */
export interface NotesStore {
  event(
    driveId: string,
    kind: string,
    data?: Record<string, unknown>,
  ): void;
  readonly sqlite: {
    query(sql: string): {
      all(...p: unknown[]): unknown[];
      get(...p: unknown[]): unknown;
      run(...p: unknown[]): unknown;
    };
  };
}

/** Land an agent finding in the drive timeline. Notes ARE timeline events —
 *  the 2000-per-drive event cap bounds growth, and they render everywhere
 *  the timeline already does. */
export function addAgentNote(
  store: NotesStore,
  input: {
    drive_id: string;
    note: string;
    origin: string;
    severity: "info" | "warn" | "critical";
  },
): void {
  store.event(input.drive_id, "agent-note", {
    note: input.note,
    origin: input.origin,
    severity: input.severity,
    dismissed_at: null,
  });
}

/** Dismiss a note (human confirmation in the UI). The event stays in the
 *  timeline (audit trail) but flagged — the active feed skips it. */
export function dismissAgentNote(
  store: NotesStore,
  driveId: string,
  eventId: string,
): boolean {
  const row = store.sqlite
    .query("SELECT * FROM events WHERE id=? AND drive_id=?")
    .get(eventId, driveId) as NoteEventRow | undefined;
  if (!row || row.kind !== "agent-note") return false;
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(row.data_json) as Record<string, unknown>;
  } catch {
    return false;
  }
  if (typeof data["dismissed_at"] === "number") return true; // already
  data["dismissed_at"] = Date.now();
  store.sqlite
    .query("UPDATE events SET data_json=? WHERE id=?")
    .run(JSON.stringify(data), eventId);
  return true;
}

/** Active (non-dismissed) notes for a drive, newest first. */
export function agentNotes(
  store: NotesStore,
  driveId: string,
  limit = 20,
): StoredNote[] {
  const rows = store.sqlite
    .query(
      "SELECT * FROM events WHERE drive_id=? AND kind='agent-note' ORDER BY at DESC LIMIT ?",
    )
    .all(driveId, limit * 2) as NoteEventRow[];
  return rows
    .map(parseNoteRow)
    .filter((n): n is StoredNote => n !== null && n.dismissed_at === null)
    .slice(0, limit);
}
