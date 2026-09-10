// PhotoTab.tsx — the drive cover-photo picker. Three sources: a file off
// your machine, an image already ON this drive, or a web image search.
// Every choice saves to BOTH places: local (data/images/<id>/) and the
// stick (Contents/CrateDeck/photo.<ext>) — plug the drive in anywhere and
// its cover travels with it. Extracted from DrivePage to keep it under the
// file-length cap; pure presentation, all state lives in the caller.
import { useRef } from "preact/hooks";
import type { Drive, DriveImage } from "../../../shared/types";
import { Icon } from "../../ui/icons";
import { ConfirmButton } from "../../ui/DrivePanels";

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
  /** images already on the drive (null = not loaded, [] = none) */
  driveImages: DriveImage[] | null;
  onChooseDriveImage: (rel: string) => void;
  onUploadFile: (file: File) => void;
}) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const mounted = props.drive.mounted;
  return (
    <div>
      <div class="note">
        <Icon name="photo" size={14} /> Pick a cover photo for this drive's card
        — saved to <b>both</b> your Mac and the stick itself
        {mounted ? (
          <> (Contents/CrateDeck/), so it travels with the hardware.</>
        ) : (
          <>
            . <b>Plug the drive in — it gets the photo the moment it mounts.</b>
          </>
        )}
      </div>
      {props.drive.photo_path ? (
        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center",
            margin: "8px 0",
          }}
        >
          <img
            src={`/photos/${props.driveId}?v=${encodeURIComponent(
              String(props.drive.last_seen_at ?? "") + ":" + Date.now(),
            )}`}
            alt={`${props.name} cover photo`}
            class="photo-preview"
            width={192}
            height={192}
          />
          <ConfirmButton
            label="Remove photo"
            confirmLabel="Remove photo — sure?"
            hint="Deletes it from your Mac and from the drive"
            onConfirm={props.onClear}
          />
        </div>
      ) : (
        <div
          class="note-card"
          style={{ margin: "8px 0", padding: "22px 16px" }}
        >
          <Icon name="photo" size={22} />
          <b>No cover photo yet</b>
          <span>
            Upload one below, pick an image off the drive, or search the web —
            it shows on this drive's card and travels on the stick.
          </span>
        </div>
      )}
      <div class="pl-tools">
        <input
          type="file"
          accept="image/*"
          ref={fileInput}
          style={{ display: "none" }}
          onChange={(e) => {
            const f = (e.target as HTMLInputElement).files?.[0];
            if (f) props.onUploadFile(f);
            // reset so picking the same file twice still fires onChange
            (e.target as HTMLInputElement).value = "";
          }}
        />
        <button
          type="button"
          class="btn"
          onClick={() => fileInput.current?.click()}
        >
          <Icon name="photo" size={14} /> Upload from Mac…
        </button>
      </div>
      <h3 class="sect" style={{ marginTop: 14 }}>
        <Icon name="usb" size={14} /> On this drive
        {!mounted && <span class="badge muted">plug in to browse</span>}
      </h3>
      {props.driveImages && props.driveImages.length > 0 && (
        <div class="photopick">
          {props.driveImages.map((img) => (
            <img
              key={img.rel}
              src={img.url}
              alt={img.rel}
              title={`${img.rel} — click to set as cover`}
              onClick={() => props.onChooseDriveImage(img.rel)}
            />
          ))}
        </div>
      )}
      {props.driveImages && props.driveImages.length === 0 && (
        <div class="note" style={{ margin: "4px 0 8px" }}>
          {mounted
            ? "No images on the drive yet — drop cover art at the stick's root or upload from your Mac."
            : "Not mounted right now — plug it in to pick from its files."}
        </div>
      )}
      <h3 class="sect" style={{ marginTop: 14 }}>
        <Icon name="search" size={14} /> Or search the web
      </h3>
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
