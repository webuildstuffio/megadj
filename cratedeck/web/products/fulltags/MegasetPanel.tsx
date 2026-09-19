// MegaSet's product canvas: settings feed a propose-only archive build and
// the resulting chain stays visibly stale until rebuilt after any change.
import { Card } from "../../ui/data";
import { SectionHead } from "../shared";
import { MegasetOpenerPicker } from "./MegasetOpenerPicker";
import { MegasetProposal } from "./megaset-proposal";
import { MegasetSettings } from "./megaset-settings";
import { useMegasetBuilder } from "./megaset-builder";

export function MegasetPanel() {
  const model = useMegasetBuilder();
  const openerPicker = (
    <MegasetOpenerPicker
      query={model.openerQuery}
      onQuery={model.setOpenerQuery}
      hits={model.openerSearch.status === "ok" ? model.openerSearch.data : null}
      hitsStatus={model.openerSearch.status}
      opener={model.opener}
      onPick={(next) => {
        if (next?.video_id === model.opener?.video_id) return;
        model.chooseOpener(next);
      }}
      busy={model.build.loading}
    />
  );
  return (
    <Card class="megaset">
      <SectionHead icon="compass" title="Build a set from your entire shelf" />
      <p class="megaset-lead">
        Choose the room's energy and a familiar length. FullTags checks the
        whole archive, removes missing files and duplicates, then orders a
        playable draft using tempo, key, and mood.
      </p>
      <MegasetSettings model={model} openerPicker={openerPicker} />
      <MegasetProposal model={model} />
    </Card>
  );
}
