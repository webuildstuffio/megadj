import type { MegasetPayload } from "../../../shared/types";
import { Icon } from "../../ui/icons";
import { saveDraft } from "./megaset-draft";

export function MegasetActions(props: {
  data: MegasetPayload;
  stale: boolean;
  exportHref: string | null;
}) {
  if (props.data.steps.length === 0) return null;
  return (
    <div class="megaset-actions" aria-label="MegaSet draft actions">
      <button
        type="button"
        class="btn ghostbtn"
        aria-label="Save draft as a local JSON file"
        disabled={props.stale}
        onClick={() => saveDraft(props.data)}
      >
        <Icon name="download" size={13} /> Save JSON draft
      </button>
      {props.stale || props.exportHref === null ? (
        <span class="btn ghostbtn" aria-disabled="true">
          <Icon name="download" size={13} /> Export .m3u8 for Rekordbox
        </span>
      ) : (
        <a
          class="btn ghostbtn"
          href={props.exportHref}
          download
          title="Download a UTF-8 M3U8 playlist; this does not open or change Rekordbox"
        >
          <Icon name="download" size={13} /> Export .m3u8 for Rekordbox
        </a>
      )}
      <span class="megaset-actions-note">
        Import the .m3u8 through Rekordbox File → Import → Playlist. Save JSON
        keeps the full technical evidence. Neither action opens or changes the
        Rekordbox database.
      </span>
    </div>
  );
}
