// TimelineTab.tsx — reverse-chron event feed, grouped by day, with kind
// chips + icons so scanning beats reading.
import { useMemo, useState } from "preact/hooks";
import type { TimelineEvent } from "../../../shared/types";
import { fmtWhen, fmtEventData } from "../../../shared/fmt";
import { Icon } from "../../ui/icons";
import { toast, apiPost } from "../../ui/toast";
import { TabIntro } from "../../ui/InfoTip";

/** Event kind → [icon, chip tone, one-line hover explanation]. Everything
 *  unknown falls back to muted + a generic line — the UI never lies about
 *  an event kind it doesn't recognize. */
const KIND_STYLE: Record<string, [string, string, string]> = {
  "job-done": ["check", "good", "A job finished successfully."],
  "job-failed": [
    "warn",
    "bad",
    "A job ran and failed — check JobsDock for the error and re-run.",
  ],
  "job-queued": [
    "clock",
    "info",
    "A job was enqueued and is waiting for its turn.",
  ],
  "bitrot-suspect": [
    "warn",
    "bad",
    "A file's bytes no longer match its checksum — possible silent corruption. Re-download or replace it.",
  ],
  scan: ["scan", "info", "The drive's library was read and a snapshot stored."],
  mounted: ["usb", "good", "The drive was plugged in and recognized."],
  "unmounted-dirty": [
    "warn",
    "warn",
    "The drive vanished without a clean eject — re-scan before trusting its numbers.",
  ],
  "first-seen": [
    "bolt",
    "info",
    "CrateDeck registered this drive permanently — it now has a history.",
  ],
  rename: ["pencil", "muted", "The drive's nickname changed."],
  "photo-set": ["photo", "muted", "The drive's cover photo changed."],
  benchmark: [
    "pulse",
    "info",
    "Read-speed benchmark ran — see the Health tab.",
  ],
  checksum: [
    "shield",
    "info",
    "Files were hashed into the corruption ledger — see Overview → Bitrot.",
  ],
  verify: [
    "shield",
    "good",
    "The deep integrity audit ran — see the Verify tab for the full breakdown.",
  ],
  mirror: [
    "refresh",
    "info",
    "The master's music was copied onto this mirror.",
  ],
  "agent-note": [
    "bolt",
    "info",
    "A finding another agent (or you, via deckctl note) left for humans to read.",
  ],
};

function dayKey(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const yest = new Date(now.getTime() - 86_400_000);
  const isYest =
    d.getFullYear() === yest.getFullYear() &&
    d.getMonth() === yest.getMonth() &&
    d.getDate() === yest.getDate();
  if (sameDay) return "today";
  if (isYest) return "yesterday";
  return d.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function TimelineTab({
  events,
  driveId,
}: {
  events: TimelineEvent[];
  driveId: string;
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const groups = useMemo(() => {
    const out: [string, TimelineEvent[]][] = [];
    let cur: string | null = null;
    for (const e of events) {
      // dismissed agent notes leave the feed (the event stays in history).
      // Server truth first (dismissed_at survives reload), then local
      // optimistic state for the just-clicked one.
      if (e.kind === "agent-note") {
        if (typeof e.data["dismissed_at"] === "number") continue;
        if (dismissed.has(e.id)) continue;
      }
      const k = dayKey(e.at);
      if (k !== cur) {
        out.push([k, [e]]);
        cur = k;
      } else {
        out[out.length - 1]![1].push(e);
      }
    }
    return out;
  }, [events, dismissed]);

  const dismiss = (noteDriveId: string, id: string) => {
    setDismissed((prev) => new Set(prev).add(id));
    apiPost(
      `/api/drives/${encodeURIComponent(noteDriveId)}/notes/${encodeURIComponent(id)}/dismiss`,
      undefined,
    ).catch(() => {
      toast("dismiss failed — reload and retry", "err");
      setDismissed((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    });
  };

  if (!events.length)
    return (
      <div class="note-card">
        <Icon name="history" size={20} />
        No events yet — mount, scan or verify to start the history.
      </div>
    );

  return (
    <div>
      <TabIntro
        what="The drive's diary: every mount, job and finding, newest first."
        how="Rows group by day. Each chip names the event kind — hover it for what that kind means. Agent notes (from deckctl note or MCP) render as dismissible cards."
      />
      {groups.map(([day, evts]) => (
        <div key={day}>
          <div class="tl-day">{day}</div>
          <div class="tl">
            {evts.map((e) => {
              const [icon, tone, why] = KIND_STYLE[e.kind] ?? [
                "dot",
                "muted",
                "An event kind this build doesn't label — details below.",
              ];
              const detail = fmtEventData(e.data);
              // O88: agent notes render as a card — severity tone + dismiss
              const isNote = e.kind === "agent-note";
              const sev =
                isNote && typeof e.data["severity"] === "string"
                  ? (e.data["severity"] as string)
                  : null;
              const noteTone =
                sev === "critical" ? "bad" : sev === "warn" ? "warn" : "info";
              const tone2 = isNote ? noteTone : tone;
              return (
                <div class="row" key={e.id} title={why}>
                  <span class={`tico kc-${tone2}`}>
                    <Icon name={icon} size={13} />
                  </span>
                  <span class="t">{fmtWhen(e.at)}</span>
                  <span class="body">
                    <span class={`kindchip kc-${tone2}`} title={why}>
                      {isNote
                        ? `agent note${sev && sev !== "info" ? ` · ${sev}` : ""}`
                        : e.kind}
                    </span>
                    <span class="detail">{detail}</span>
                    {isNote && (
                      <button
                        class="btn ghostbtn sm dismiss-btn"
                        onClick={() => dismiss(driveId, e.id)}
                        title="Dismiss this note (stays in history)"
                      >
                        dismiss
                      </button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
