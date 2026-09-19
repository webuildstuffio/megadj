import { writeJson } from "../../shared/cli-output";
import { refoldDetail } from "./genre-refold";
import { isUmbrellaLabel } from "./genre-vocab";
import type { GenreOptions } from "./genre-run-types";

type CommandLog = (message: string) => void;

interface RefoldChange {
  video_id: string;
  from: string;
  to: string;
  escaped: boolean;
  split: boolean;
  aliased: boolean;
}

function classifyRefoldPopulation(opts: GenreOptions): {
  labeled: ReturnType<GenreOptions["state"]["labeledPopulation"]>;
  changes: RefoldChange[];
  unstrand: { video_id: string; from: string }[];
  unchanged: number;
  abstained: number;
} {
  const labeled = opts.state.labeledPopulation();
  const changes: RefoldChange[] = [];
  const unstrand: { video_id: string; from: string }[] = [];
  let unchanged = 0;
  let abstained = 0;
  for (const row of labeled) {
    const detail = refoldDetail(row.genre);
    if (detail.label === null) {
      const raw = row.genre.trim().toLowerCase();
      if (raw === "music" || raw === "unknown" || raw === "fixme")
        unstrand.push({ video_id: row.video_id, from: row.genre });
      else unchanged++;
      continue;
    }
    if (detail.label === row.genre) {
      unchanged++;
      continue;
    }
    if (isUmbrellaLabel(detail.label)) {
      const casingOnly =
        detail.label.toLowerCase() === row.genre.trim().toLowerCase();
      if (!detail.split && !casingOnly) {
        abstained++;
        continue;
      }
      changes.push({
        video_id: row.video_id,
        from: row.genre,
        to: detail.label,
        escaped: detail.escaped,
        split: detail.split,
        aliased: true,
      });
      continue;
    }
    changes.push({
      video_id: row.video_id,
      from: row.genre,
      to: detail.label,
      escaped: detail.escaped,
      split: detail.split,
      aliased: detail.aliased,
    });
  }
  return { labeled, changes, unstrand, unchanged, abstained };
}

/** Propose or apply canonicalization over the labeled population. */
export async function runGenreRefold(
  opts: GenreOptions,
  log: CommandLog,
): Promise<boolean> {
  if (!opts.refold) return false;
  const { labeled, changes, unstrand, unchanged, abstained } =
    classifyRefoldPopulation(opts);
  log(
    `genre refold: ${changes.length} changeable of ${labeled.length} labeled (${abstained} umbrella rows kept honest, ${unchanged} already canonical, ${unstrand.length} placeholder rows to unstrand) — ${opts.apply ? "WRITTEN" : "proposals only (use --apply to write)"}`,
  );
  for (const change of changes.slice(0, 20))
    log(`  ${JSON.stringify(change.from)} → ${JSON.stringify(change.to)}`);
  await writeJson({
    command: "genre",
    mode: "refold",
    labeled: labeled.length,
    changes: changes.length,
    umbrellaKept: abstained,
    alreadyCanonical: unchanged,
    unstrand: unstrand.length,
    applied: opts.apply === true,
    samples: changes.slice(0, 40),
  });
  if (opts.apply) {
    for (const change of changes)
      opts.state.updateGenre(change.video_id, change.to);
    for (const placeholder of unstrand)
      opts.state.clearGenre(placeholder.video_id);
  }
  return true;
}
