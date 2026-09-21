import {
  megasetTransitionBand,
  type MegasetPresetDef,
  type MegasetStep,
} from "../../../shared/types";
import { DataTable, ListHead, type DataTableColumn } from "../../ui/data";
import { MegasetArcChart } from "./MegasetArcChart";

const fmtBpm = (bpm: number | null): string =>
  bpm === null ? "—" : String(Math.round(bpm * 10) / 10);

const stepLine = (step: MegasetStep): string =>
  `${step.atMin}min  ${fmtBpm(step.bpm)} BPM ${step.key ?? ""}  ${step.artist ?? "?"} — ${step.title ?? step.videoId}`;

const columns: DataTableColumn<MegasetStep>[] = [
  {
    key: "pos",
    head: "#",
    align: "end",
    min: 34,
    grow: 0,
    cell: (_step, index) => index + 1,
  },
  {
    key: "track",
    head: "track",
    grow: 2,
    cell: (step) => (
      <>
        <b>{step.title ?? step.videoId}</b>
        {step.artist && <span class="covartist"> — {step.artist}</span>}
      </>
    ),
    sortValue: (step) => (step.title ?? step.videoId).toLowerCase(),
  },
  {
    key: "bpm",
    head: "bpm",
    align: "end",
    min: 56,
    grow: 0,
    cell: (step) => fmtBpm(step.bpm),
    sortValue: (step) => step.bpm,
  },
  {
    key: "key",
    head: "key",
    align: "center",
    min: 48,
    grow: 0,
    cell: (step) => step.key ?? "—",
    sortValue: (step) => step.key,
  },
  {
    key: "mix",
    head: "mix",
    align: "center",
    min: 44,
    grow: 0,
    cell: (step) =>
      step.transition === null ? (
        <span title="Opener — no transition into it">open</span>
      ) : (
        (() => {
          // bands derived from the shared seam (calibrated Sep 21 — the
          // old fixed 0.75/0.5 cut-offs predated the anchor+similarity
          // bonuses and read "clean" on every live blend)
          const band = megasetTransitionBand(step.transition);
          return (
            <span
              class={`arch-pill ${band.cls}`}
              title={`transition score into this track: ${step.transition.toFixed(3)} (tempo + key + arc fit + anchor + similarity)`}
            >
              {band.label}
            </span>
          );
        })()
      ),
    sortValue: (step) => step.transition,
  },
  {
    key: "at",
    head: "at",
    align: "end",
    min: 48,
    grow: 0,
    cell: (step) => `${step.atMin}m`,
    sortValue: (step) => step.atMin,
  },
];

function rowTone(step: MegasetStep): "" | "ok" | "warn" {
  if (step.transition === null) return "";
  // row tone follows the same calibrated band, not a private cut-off
  return megasetTransitionBand(step.transition).label === "tight"
    ? "warn"
    : "ok";
}

export function MegasetChain(props: {
  steps: MegasetStep[];
  preset: MegasetPresetDef;
  keyGlide: string | null;
}) {
  return (
    <>
      {props.steps.length > 0 && (
        <ListHead
          icon="play"
          title="The chain"
          n={props.steps.length}
          hint="Ordered mix proposal: key-compatible (Camelot), tempo within ±6%, energy following the arc. Copy hands it to an agent or your notes. Click a column to sort."
          lines={props.steps.map(stepLine)}
        />
      )}
      <DataTable
        columns={columns}
        rows={props.steps}
        cap={40}
        ariaLabel="MegaSet builder chain"
        copyName="The chain"
        copyLines={(rows) => rows.map(stepLine)}
        rowTone={rowTone}
      />
      {props.steps.length >= 2 && (
        <MegasetArcChart
          steps={props.steps}
          preset={props.preset}
          keyGlide={props.keyGlide}
        />
      )}
    </>
  );
}
