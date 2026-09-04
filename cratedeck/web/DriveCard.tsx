import type { DriveCardData } from "../shared/types";

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

export function fmtBytes(n: number): string {
  if (n >= 1e12) return (n / 1e12).toFixed(1) + " TB";
  if (n >= 1e9) return (n / 1e9).toFixed(0) + " GB";
  if (n >= 1e6) return (n / 1e6).toFixed(0) + " MB";
  return Math.round(n) + " B";
}

export function timeAgo(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
