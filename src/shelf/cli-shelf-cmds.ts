// cli-shelf-cmds.ts — the shelf-family CLI case bodies, extracted from
// cli.ts's main switch at the complexity guard. Each runner takes the
// parsed rest-args and owns its dynamic import; main stays the dispatcher
// (the usage census parses PRE_SERVER_VERBS in cli.ts, so the verbs
// themselves never move).
import { ArchiveState } from "../archive/state";
import { MUSIC_DIR, DB_PATH } from "../cli-env";
import { resolveShelfVolume, volumePath } from "../shared/volume";

/** shelf-sync: shelf master → both sticks. Volume names come from
 *  config.toml [library] via env overrides — never hardcoded literals. */
export async function runShelfSync(rest: string[]): Promise<void> {
  const json = rest.includes("--json");
  const dryRun = rest.includes("--dry-run");
  const shelfVolume = resolveShelfVolume();
  const stickVolumes = [
    process.env.USB_SYNC_MASTER ?? "DJMASTER",
    process.env.USB_SYNC_MIRROR ?? "DJMIRROR",
  ];
  const { shelfSync } = await import("./shelf-sync");
  await shelfSync({
    musicDir: MUSIC_DIR,
    shelfVolume,
    stickVolumes: stickVolumes.map(volumePath),
    dryRun,
    json,
  });
}

/** shelf-archive: drive(s) → shelf, additive + verified. The
 *  generalization of the Sep 9 2026 three-stick manual merge. */
export async function runShelfArchive(rest: string[]): Promise<void> {
  const json = rest.includes("--json");
  const dryRun = rest.includes("--dry-run");
  const deep = rest.includes("--deep");
  const trashes = rest.includes("--trashes");
  const intoEq = rest.find((a) => a.startsWith("--into="));
  const into = intoEq ? decodeURIComponent(intoEq.slice(7)) : undefined;
  const shelfVolume = resolveShelfVolume();
  const suffixEq = rest.find((a) => a.startsWith("--suffix="));
  const suffix = suffixEq ? suffixEq.slice(9) : undefined;
  // positional volumes; default to the configured master+mirror when none
  // are named (the "did both sticks fully land?" check)
  const master = process.env.USB_SYNC_MASTER ?? "DJMASTER";
  const mirror = process.env.USB_SYNC_MIRROR ?? "DJMIRROR";
  const positionals = rest.filter(
    (a) => !a.startsWith("--") && a !== "shelf-archive",
  );
  const volumes = positionals.length ? positionals : [master, mirror];
  const { shelfArchive } = await import("./shelf-archive");
  await shelfArchive({
    volumes: volumes.map((v) => volumePath(v)),
    shelfVolume,
    into,
    trashes,
    deep,
    suffix,
    dryRun,
    json,
  });
}

/** shelf-sweeps: the DB record of every drive → shelf sweep. `--json` =
 *  full history; text = one line per drive. */
export async function runShelfSweeps(rest: string[]): Promise<void> {
  const json = rest.includes("--json");
  const state = new ArchiveState(DB_PATH);
  try {
    const rows = state.shelfSweeps.latestPerDrive();
    const hist = state.shelfSweeps.history();
    if (json) {
      console.log(
        JSON.stringify(
          { command: "shelf-sweeps", latest: rows, history: hist },
          null,
          2,
        ),
      );
    } else {
      console.log("shelf sweeps (latest per drive):");
      for (const r of rows) {
        const done = r.finished_at ? r.finished_at.slice(0, 10) : "running";
        const gb = (r.bytes_copied / 1e9).toFixed(2);
        console.log(
          `  ${r.drive.padEnd(16)} ${r.verdict.padEnd(9)} ${done}  ` +
            `${r.files_seen} files · ${r.covered_exact} covered · ${r.preserved} preserved · ${r.copied} copied (${gb} GB)${r.failed ? ` · FAILED ${r.failed}` : ""}${r.deep ? " · deep" : ""}`,
        );
      }
      if (rows.length === 0)
        console.log("  (no sweeps recorded yet — run megadj shelf-archive)");
    }
  } finally {
    state.close();
  }
}
