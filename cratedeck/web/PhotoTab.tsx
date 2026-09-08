// PhotoTab.tsx — the drive cover-photo picker (search provider hits +
// current-photo remove). Extracted from DrivePage to keep it under the
// file-length cap; pure presentation, all state lives in the caller.
import type { Drive } from "../shared/types";
import { Icon } from "./icons";
import { ConfirmButton } from "./DrivePanels";

export interface PhotoHit {
  id: string;
  thumb: string;
  full: string;
  source: string;
}

export function PhotoTab(props: {
  drive: Drive;
  driveId: string;
  name: string;
  photoQuery: string;
  setPhotoQuery: (q: string) => void;
  onSearch: () => void;
  hits: PhotoHit[] | null;
  onChoose: (h: PhotoHit) => void;
  onClear: () => void;
}) {
  return (
    <div>
      <div class="note">
        <Icon name="photo" size={14} /> Pick a cover photo for this drive's card
        — it's saved locally and shown across the app. Search by any
        artist/venue/keyword; click a hit to set it, Remove photo to clear.
      </div>
      {props.drive.photo_path && (
        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center",
            margin: "8px 0",
          }}
        >
          <img
            src={`/photos/${props.driveId}?v=${props.drive.last_seen_at}`}
            alt={props.name}
            style={{
              width: 140,
              height: 105,
              objectFit: "cover",
              borderRadius: 12,
              border: "1px solid var(--stroke)",
            }}
          />
          <ConfirmButton
            label="Remove photo"
            confirmLabel="Remove photo — sure?"
            hint="Deletes the cover photo (the file stays on disk untouched)"
            onConfirm={props.onClear}
          />
        </div>
      )}
      <div class="pl-tools">
        <input
          placeholder={`Search images for “${props.name}”…`}
          value={props.photoQuery}
          onInput={(e) =>
            props.setPhotoQuery((e.target as HTMLInputElement).value)
          }
          onKeyDown={(e) => e.key === "Enter" && props.onSearch()}
        />
        <button type="button" class="btn" onClick={props.onSearch}>
          <Icon name="search" size={14} /> Search
        </button>
      </div>
      {props.hits && (
        <div class="photopick">
          {props.hits.map((h) => (
            <img
              key={h.id}
              src={h.thumb}
              alt={h.source}
              title={`source: ${h.source}`}
              onClick={() => props.onChoose(h)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
