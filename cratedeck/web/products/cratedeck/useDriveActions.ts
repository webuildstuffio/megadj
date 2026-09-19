import { useCallback, useEffect, useState } from "preact/hooks";
import type { DriveImage, Job } from "../../../shared/types";
import { api, apiPost, toast } from "../../ui/toast";
import type { PhotoHit } from "./PhotoTab";

export function useDriveActions(props: {
  driveId: string;
  tab: string;
  mounted: boolean;
  photoFallbackName: string;
  refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [photoHits, setPhotoHits] = useState<PhotoHit[] | null>(null);
  const [photoQuery, setPhotoQuery] = useState("");
  const [driveImages, setDriveImages] = useState<DriveImage[] | null>(null);

  const run = async (kind: string) => {
    setBusy(kind);
    try {
      await apiPost<Job>(`/api/drives/${props.driveId}/jobs`, { kind });
      toast(`${kind} queued`, "ok");
    } catch {
      /* toast already surfaced the failure */
    } finally {
      setBusy(null);
    }
  };

  const rename = async (nickname: string | null) => {
    try {
      await apiPost(`/api/drives/${props.driveId}/name`, {
        nickname: nickname || null,
      });
    } catch {
      return;
    }
    setRenaming(false);
    toast(nickname ? "Drive renamed" : "Nickname cleared", "ok");
    props
      .refresh()
      .catch((error: unknown) =>
        console.error("post-rename refresh failed", error),
      );
  };

  const searchPhotos = async () => {
    const query = photoQuery.trim() || props.photoFallbackName;
    try {
      const result = await api<{ provider: string; hits: PhotoHit[] }>(
        `/api/images/search?q=${encodeURIComponent(query)}`,
      );
      if (!result.hits.length) {
        toast(
          result.provider === "none"
            ? "No image provider configured (config.toml → images)"
            : "No images found",
          "info",
        );
        return;
      }
      setPhotoHits(result.hits);
    } catch (error) {
      console.error("photo search failed", error);
    }
  };

  const refreshAfterPhotoSave = () =>
    props
      .refresh()
      .catch((error: unknown) =>
        console.error("post-save refresh failed", error),
      );

  const choosePhoto = async (hit: PhotoHit) => {
    try {
      await apiPost(`/api/drives/${props.driveId}/photo`, { url: hit.full });
      toast("Photo saved to Mac + drive", "ok");
      refreshAfterPhotoSave();
    } catch {
      /* toast already surfaced the failure */
    }
  };

  const chooseDriveImage = async (relativePath: string) => {
    try {
      await apiPost(`/api/drives/${props.driveId}/photo`, {
        drive_rel: relativePath,
      });
      toast("Cover set from the drive — saved to Mac too", "ok");
      refreshAfterPhotoSave();
    } catch {
      /* toast already surfaced the failure */
    }
  };

  const uploadPhoto = async (file: File) => {
    try {
      const form = new FormData();
      form.append("file", file);
      await apiPost(`/api/drives/${props.driveId}/photo`, form);
      toast("Photo saved to Mac + drive", "ok");
      refreshAfterPhotoSave();
    } catch {
      /* toast already surfaced the failure */
    }
  };

  const loadDriveImages = useCallback(async () => {
    if (!props.mounted) {
      setDriveImages(null);
      return;
    }
    try {
      setDriveImages(
        await api<DriveImage[]>(
          `/api/drives/${encodeURIComponent(props.driveId)}/drive-images`,
          { quiet: true },
        ),
      );
    } catch (error) {
      // null = "not loaded" (the tab's tri-state contract) — a load failure
      // must NOT read as "no images on the drive", which the tab renders
      // as a fact. Degrade to null so the section stays silent + logged.
      console.error(`drive-images load for ${props.driveId} failed`, error);
      setDriveImages(null);
    }
  }, [props.driveId, props.mounted]);

  useEffect(() => {
    if (props.tab === "photos") {
      loadDriveImages().catch((error: unknown) =>
        console.error("drive-images effect failed", error),
      );
    }
  }, [props.tab, loadDriveImages]);

  const clearPhoto = async () => {
    try {
      await apiPost(`/api/drives/${props.driveId}/photo`, { clear: true });
      toast("Photo removed", "ok");
      void props.refresh();
    } catch {
      /* toast already surfaced the failure */
    }
  };

  return {
    busy,
    renaming,
    nameDraft,
    photoHits,
    photoQuery,
    driveImages,
    setRenaming,
    setNameDraft,
    setPhotoQuery,
    run,
    rename,
    searchPhotos,
    choosePhoto,
    chooseDriveImage,
    uploadPhoto,
    clearPhoto,
  };
}
