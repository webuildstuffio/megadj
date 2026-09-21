import { isShelfOffline, type MegasetPayload } from "../../../shared/types";
import { Icon } from "../../ui/icons";
import { MegasetActions } from "./megaset-actions";
import { MegasetChain } from "./megaset-chain";
import { MegasetMethod } from "./MegasetMethod";
import { MegasetResult } from "./MegasetResult";
import {
  ExcludedBreakdown,
  FreshnessLine,
  MegasetLoading,
  ReproLine,
} from "./MegasetStatus";
import type { MegasetBuilder } from "./megaset-builder";

function StaleNotice(props: { stale: boolean }) {
  if (!props.stale) return null;
  return (
    <div class="megaset-stale" role="status">
      <b>Proposal settings changed.</b> The chain below still shows the previous
      build. Update it before using or copying the result.
    </div>
  );
}

function ErrorNotice(props: { error: string | null }) {
  if (!props.error) return null;
  return (
    <div class="arch-fix" role="alert">
      Build failed: {props.error}
    </div>
  );
}

function LoadingNotice(props: { loading: boolean; startedAt: number | null }) {
  if (!props.loading || props.startedAt === null) return null;
  return <MegasetLoading startedAt={props.startedAt} />;
}

function PartialDraftNotice(props: { data: MegasetPayload }) {
  const { data } = props;
  if (data.complete || data.pool <= 0 || isShelfOffline(data, data))
    return null;
  return (
    <div class="megaset-shortfall" role="alert">
      <Icon name="warn" size={16} />
      <span>
        <b>Partial draft — not a complete set.</b> FullTags found{" "}
        {data.actualMinutes} of the requested {data.minutes} minutes, leaving{" "}
        {data.shortfallMinutes} minutes short. Review the exclusions or choose a
        shorter target before export.
      </span>
    </div>
  );
}

function Exclusions(props: { data: MegasetPayload }) {
  if (props.data.excluded_total <= 0) return null;
  return <ExcludedBreakdown data={props.data} />;
}

function ProposalBody(props: { model: MegasetBuilder; genre: string | null }) {
  const { model } = props;
  const data = model.build.data;
  if (!data) return null;
  return (
    <>
      <MegasetResult data={data} />
      <PartialDraftNotice data={data} />
      <FreshnessLine freshness={data.freshness} pool={data.pool} />
      <MegasetActions
        data={data}
        stale={model.build.stale}
        exportHref={model.exportHref}
        draftKnobs={{
          searchChoice: model.searchChoice,
          poolLimit: model.poolLimit,
          openerId: model.opener?.video_id ?? null,
          genre: props.genre,
        }}
      />
      <MegasetChain
        steps={model.steps}
        preset={model.preset}
        keyGlide={model.keyGlide}
      />
      <ReproLine
        data={data}
        searchChoice={model.searchChoice}
        poolLimit={model.poolLimit}
        openerId={model.opener?.video_id ?? null}
        genre={props.genre}
      />
      <Exclusions data={data} />
    </>
  );
}

export function MegasetProposal(props: { model: MegasetBuilder }) {
  const { build } = props.model;
  return (
    <>
      <MegasetMethod />
      <StaleNotice stale={build.stale} />
      <ErrorNotice error={build.error} />
      <LoadingNotice loading={build.loading} startedAt={build.startedAt} />
      <ProposalBody
        model={props.model}
        genre={
          build.data?.genre_filtered ? props.model.genreInput.trim() : null
        }
      />
    </>
  );
}
