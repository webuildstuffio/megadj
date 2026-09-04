import type { DriveCardData } from "../shared/types";
import { fmtBytes, timeAgo } from "../shared/fmt";

const toneColor: Record<string, string> = {
  good: "var(--good)",
  warn: "var(--warn)",
  bad: "var(--bad)",
  info: "var(--info)",
  muted: "var(--muted)",
};

export function DriveCard({
  drive,
  onOpen,
}: {
  drive: DriveCardData;
  onOpen: () => void;
}) {
  const name = drive.nickname ?? drive.name;
  const snap = drive.last_snapshot_json
    ? JSON.parse(drive.last_snapshot_json)
    : null;
  const cap = drive.capacity_bytes ? fmtBytes(drive.capacity_bytes) : null;
  const seen = timeAgo(drive.last_seen_at);

  return (
    <div class={"card" + (drive.mounted ? "" : " ghost")} onClick={onOpen}>
      <div class="photo">
        {drive.photo_path ? (
          <img src={`/photos/${drive.id}`} alt={name} />
        ) : (
          "◉"
        )}
      </div>
      <div class="name" title={name}>
        {name}
        {drive.role !== "unknown" && (
          <span
            style={{ color: "var(--muted)", fontWeight: 400, fontSize: 12 }}
          >
            {" "}
            · {drive.role}
          </span>
        )}
      </div>
      <div class="sub" title={`${cap ?? ""} · ${drive.name}`}>
        {cap ? `${cap} · ` : ""}
        {drive.mounted ? "mounted" : `ghost · seen ${seen}`}
        {snap?.track_count
          ? ` · ${snap.track_count.toLocaleString()} tracks`
          : ""}
        {snap?.file_count && !snap.track_count
          ? ` · ${snap.file_count.toLocaleString()} files`
          : ""}
      </div>
      <div class="badges">
        {drive.badges.map((b) => (
          <span
            class={`badge ${b.tone}`}
            key={b.key + ":" + b.label}
            style={{ color: toneColor[b.tone] }}
          >
            {b.label}
          </span>
        ))}
      </div>
    </div>
  );
}
