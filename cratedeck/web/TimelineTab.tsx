// TimelineTab.tsx — reverse-chron event feed, grouped by day, with kind
// chips + icons so scanning beats reading.
import { useMemo, useState } from "preact/hooks";
import type { TimelineEvent } from "../shared/types";
import { fmtWhen, fmtEventData } from "../shared/fmt";
import { Icon } from "./icons";
import { toast } from "./toast";

/** Event kind → [icon, chip tone]. Everything unknown falls back to muted. */
const KIND_STYLE: Record<string, [string, string]> = {
  "job-done": ["check", "good"],
  "job-failed": ["warn", "bad"],
  "job-queued": ["clock", "info"],
  "bitrot-suspect": ["warn", "bad"],
  scan: ["scan", "info"],
  mounted: ["usb", "good"],
  "unmounted-dirty": ["warn", "warn"],
  "first-seen": ["bolt", "info"],
  rename: ["pencil", "muted"],
  "photo-set": ["photo", "muted"],
  benchmark: ["pulse", "info"],
  checksum: ["shield", "info"],
  verify: ["shield", "good"],
  mirror: ["refresh", "info"],
  "agent-note": ["bolt", "info"],
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

  const dismiss = (driveId: string, id: string) => {
    setDismissed((prev) => new Set(prev).add(id));
    fetch(
      `/api/drives/${encodeURIComponent(driveId)}/notes/${encodeURIComponent(id)}/dismiss`,
      {
        method: "POST",
      },
    )
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
      })
      .catch(() => {
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
      {groups.map(([day, evts]) => (
        <div key={day}>
          <div class="tl-day">{day}</div>
          <div class="tl">
            {evts.map((e) => {
              const [icon, tone] = KIND_STYLE[e.kind] ?? ["dot", "muted"];
              const detail = fmtEventData(e.data);
              // O88: agent notes render as a card — severity tone + dismiss
              const sev =
                e.kind === "agent-note" &&
                typeof e.data["severity"] === "string"
                  ? (e.data["severity"] as string)
                  : null;
              const noteTone =
                sev === "critical" ? "bad" : sev === "warn" ? "warn" : "info";
              return (
                <div class="row" key={e.id}>
                  <span
                    class={`tico kc-${e.kind === "agent-note" ? noteTone : tone}`}
                  >
                    <Icon name={icon} size={13} />
                  </span>
                  <span class="t">{fmtWhen(e.at)}</span>
                  <span class="body">
                    <span
                      class={`kindchip kc-${e.kind === "agent-note" ? noteTone : tone}`}
                    >
                      {e.kind === "agent-note"
                        ? `agent note${sev && sev !== "info" ? ` · ${sev}` : ""}`
                        : e.kind}
                    </span>
                    <span class="detail">{detail}</span>
                    {e.kind === "agent-note" && (
                      <button
                        class="btn ghostbtn sm"
                        style={{ marginLeft: "8px" }}
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
