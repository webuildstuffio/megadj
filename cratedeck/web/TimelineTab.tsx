// TimelineTab.tsx — reverse-chron event feed, grouped by day, with kind
// chips + icons so scanning beats reading.
import { useMemo } from "preact/hooks";
import type { TimelineEvent } from "../shared/types";
import { fmtWhen, fmtEventData } from "../shared/fmt";
import { Icon } from "./icons";

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

export function TimelineTab({ events }: { events: TimelineEvent[] }) {
  const groups = useMemo(() => {
    const out: [string, TimelineEvent[]][] = [];
    let cur: string | null = null;
    for (const e of events) {
      const k = dayKey(e.at);
      if (k !== cur) {
        out.push([k, [e]]);
        cur = k;
      } else {
        out[out.length - 1]![1].push(e);
      }
    }
    return out;
  }, [events]);

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
              return (
                <div class="row" key={e.id}>
                  <span class={`tico kc-${tone}`}>
                    <Icon name={icon} size={13} />
                  </span>
                  <span class="t">{fmtWhen(e.at)}</span>
                  <span class="body">
                    <span class={`kindchip kc-${tone}`}>{e.kind}</span>
                    <span class="detail">{detail}</span>
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
