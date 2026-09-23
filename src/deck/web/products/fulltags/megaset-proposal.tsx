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

/** #286: the measured stage split (stages_ms) — rendered once the build
 *  returns so the phase list's promises get their actual numbers. The
 *  loading checklist (MegasetLoading) stays schedule-based pre-response;
 *  this is the honest "what it actually cost" answer after. Exported for
 *  the direct-render test (the panel wires it below). */
export function StageTimings(props: { data: MegasetPayload }) {
  const stages = props.data.stages_ms;
  if (!stages) return null;
  const rows: [string, number][] = [
    ["archive database read", stages.sql],
    ["shelf file check", stages.fileCheck],
    ["analysis joins + key fills", stages.keyFills],
    ["chain sequencing", stages.engine],
  ];
  const total = rows.reduce((sum, [, ms]) => sum + ms, 0);
  if (total <= 0) return null;
  return (
    <details class="megaset-stages">
      <summary>
        where the{" "}
        {total < 1000 ? `${total} ms` : `${(total / 1000).toFixed(1)} s`} went
      </summary>
      <ul>
        {rows.map(([label, ms]) => (
          <li key={label}>
            {label}: <strong>{ms.toLocaleString("en-US")} ms</strong>
          </li>
        ))}
      </ul>
    </details>
  );
}

function ProposalBody(props: { model: MegasetBuilder; genre: string | null }) {
  const { model } = props;
  const data = model.build.data;
  if (!data) return null;
  return (
    <>
      <MegasetResult data={data} />
      <PartialDraftNotice data={data} />
      <StageTimings data={data} />
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
          landmarkIds: model.landmarkIds,
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
        landmarkIds={model.landmarkIds}
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
