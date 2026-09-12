import type {
  DriveImage,
  DriveReport,
  VerifyReport,
} from "../../../shared/types";
import type { PhotoHit } from "./PhotoTab";
import { PhotoTab } from "./PhotoTab";
import { PlaylistsTab } from "./PlaylistsTab";
import { HealthTab, type HealthTabBench } from "./HealthTab";
import { TimelineTab } from "./TimelineTab";
import { VerifyTab } from "./VerifyTab";
import { OverviewTab } from "./OverviewTab";
import { HygieneTab } from "./HygieneTab";
import { FixesTab } from "./FixesTab";
import type { DriveDetail } from "./useDriveData";

export function DriveContent(props: {
  tab: string;
  driveId: string;
  detail: DriveDetail;
  name: string;
  report: (DriveReport & { overall?: string }) | null;
  timeline: Parameters<typeof TimelineTab>[0]["events"];
  bench: HealthTabBench[];
  probes: { ran_at: number; mbps: number }[];
  verify: VerifyReport | null;
  isShelf: boolean | undefined;
  photoQuery: string;
  setPhotoQuery: (query: string) => void;
  photoHits: PhotoHit[] | null;
  onSearchPhotos: () => void;
  onChoosePhoto: (hit: PhotoHit) => void;
  onClearPhoto: () => void;
  driveImages: DriveImage[] | null;
  onChooseDriveImage: (relativePath: string) => void;
  onUploadPhoto: (file: File) => void;
}) {
  const { detail } = props;
  const snapshot = detail.snapshot;
  const dj = snapshot?.dj ?? null;
  const checks = props.report?.checks ?? [];
  switch (props.tab) {
    case "playlists":
      return <PlaylistsTab snap={snapshot} />;
    case "health":
      return (
        <HealthTab
          drive={detail.drive}
          snap={snapshot}
          bench={props.bench}
          probes={props.probes}
        />
      );
    case "verify":
      return <VerifyTab driveId={props.driveId} report={props.verify} />;
    case "timeline":
      return <TimelineTab events={props.timeline} driveId={props.driveId} />;
    case "photos":
      return (
        <PhotoTab
          drive={detail.drive}
          driveId={props.driveId}
          name={props.name}
          photoQuery={props.photoQuery}
          setPhotoQuery={props.setPhotoQuery}
          onSearch={props.onSearchPhotos}
          hits={props.photoHits}
          onChoose={props.onChoosePhoto}
          onClear={props.onClearPhoto}
          driveImages={props.driveImages}
          onChooseDriveImage={props.onChooseDriveImage}
          onUploadFile={props.onUploadPhoto}
        />
      );
    case "hygiene":
      return props.isShelf ? (
        <HygieneTab driveId={props.driveId} driveName={props.name} />
      ) : null;
    case "fixes":
      return props.isShelf ? (
        <FixesTab driveId={props.driveId} driveName={props.name} />
      ) : null;
    case "overview":
    default:
      return (
        <OverviewTab
          name={props.name}
          snap={snapshot}
          dj={dj}
          checks={checks}
        />
      );
  }
}
