/**
 * maintenance-cmds.ts — the shelf-maintenance command cases for cli.ts
 * (file-length guard: cli.ts sits at the 800-line cap; these cases
 * live here as one unit, same seam as the old shelf_cmds.ts). Pure
 * flag-parsing + dynamic import + delegation — all logic lives in
 * src/commands/shelf-hygiene.ts, rb-fix-paths.ts, and grid-triage.ts.
 *
 * Flags go through cli-flags.ts (`parseFlags`/`nonNegOpt`/
 * `firstPositional`) — the sanctioned parser. Hand-rolling broke three
 * ways at once (super-sure pass, Sep 10): space-form flags documented in
 * usage/runbook (`--tag q1`, `--limit 20`) silently unparsed; `--limit
 * 20` parsed the value as NaN and `slice(0, Math.max(0, NaN))` triaged
 * ZERO rows while "succeeding" (the exact Number() trap AGENTS.md
 * bans); and the positional filter ate the `snapshot`/`compare` mode
 * word plus `--compare DJMASTER`'s value.
 */

import { DB_PATH } from "../cli-env";
import { parseFlags, nonNegOpt } from "../cli-flags";
import { ArchiveState } from "../state";

/** Commands handled by this module; cli.ts and the parity census share it. */
export const MAINTENANCE_VERBS = [
  "shelf-hygiene",
  "rb-fix-paths",
  "rb-anlz-spike",
  "rb-grid-triage",
] as const;

/** Resolve the drive mount: first positional (`SHELF1` or an absolute
 * path) else the configured volume name. Shared by every case below. */
function mountFrom(positional: string | undefined): string {
  if (positional)
    return positional.startsWith("/") ? positional : `/Volumes/${positional}`;
  const shelfVolume = process.env.MEGADJ_SHELF_VOLUME ?? "SHELF1";
  return `/Volumes/${shelfVolume}`;
}

/** Repeatable `--key=value` string options (shelf-hygiene's
 * confirm/dismiss lists). */
function manyOf(rest: string[], key: string): string[] {
  return rest
    .filter((a) => a.startsWith(`--${key}=`))
    .map((a) => a.slice(key.length + 3))
    .filter((v): v is string => v.length > 0);
}

/** First positional that is not a consumed flag VALUE: `--tag q1
 * snapshot` must not read "q1" as a positional. Mirrors parseFlags'
 * space-form consumption (a `--key` in stringOpts eats the next
 * non-flag arg). */
function positionalArgs(rest: string[], stringOpts: string[]): string[] {
  const isFlagValue = new Set<number>();
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === undefined || !a.startsWith("--") || a.includes("=")) continue;
    const key = a.slice(2);
    if (!stringOpts.includes(key)) continue;
    const next = rest[i + 1];
    if (next !== undefined && !next.startsWith("--")) isFlagValue.add(i + 1);
  }
  return rest.filter((a, i) => !a.startsWith("--") && !isFlagValue.has(i));
}

export async function runMaintenanceCommand(
  command: string,
  rest: string[],
): Promise<void> {
  switch (command) {
    case "shelf-hygiene": {
      // Detect → ledger → review → apply → validate (the shelf-hygiene
      // feature, CLI half; the web queue lives in CrateDeck). Findings
      // live in the archive DB — the SSOT every surface reads.
      const flags = parseFlags(
        rest,
        ["kind", "shelf", "bucket"],
        ["json", "apply", "yes"],
      );
      const { shelfHygiene } = await import("./shelf-hygiene");
      await shelfHygiene({
        json: flags.bools.has("json"),
        apply: flags.bools.has("apply"),
        yes: flags.bools.has("yes"),
        // repeatable list flags stay raw-parsed: parseFlags keeps only
        // the last value per key, and confirm/dismiss are multi-value
        confirm: manyOf(rest, "confirm"),
        dismiss: manyOf(rest, "dismiss"),
        kind: flags.strings.get("kind"),
        bucket: flags.strings.get("bucket"),
        shelfVolume: flags.strings.get("shelf"),
      });
      return;
    }
    case "rb-fix-paths": {
      // rekordbox library repair: stale djmdContent.FolderPath rows after
      // folder moves/merges. Dry-run by default; --apply --yes rewrites
      // rows (backs the DB up first, refuses while rekordbox runs).
      const flags = parseFlags(rest, [], ["json", "apply", "yes"]);
      const mount = mountFrom(positionalArgs(rest, [])[0]);
      const { rbFixPaths, printRbFixReport } = await import("./rb-fix-paths");
      const json = flags.bools.has("json");
      const r = await rbFixPaths({
        mount,
        apply: flags.bools.has("apply"),
        yes: flags.bools.has("yes"),
        json,
        log: (s) => (json ? undefined : console.log(s)),
      });
      if (json) {
        console.log(JSON.stringify(r));
      } else {
        printRbFixReport(r, console.log);
      }
      if (!r.ok) process.exitCode = 1;
      return;
    }
    case "rb-anlz-spike": {
      // GA-07 harness: snapshot/compare ANLZ sidecars around a manual
      // rekordbox experiment (re-export, grid nudge). Read-only on the
      // drive; the baseline lives in ~/.local/state/megadj/spike/.
      const flags = parseFlags(rest, ["tag"], ["json"]);
      // Two positionals: mount (first) + mode word (snapshot|compare).
      // Order-free per usage: `[drive] snapshot|compare`.
      const args = positionalArgs(rest, ["tag"]);
      const modeWord = args.find((a) => a === "snapshot" || a === "compare");
      const mountPos = args.find((a) => a !== "snapshot" && a !== "compare");
      const mode: "snapshot" | "compare" =
        modeWord === "compare" ? "compare" : "snapshot";
      if (
        args.some((a) => a !== "snapshot" && a !== "compare" && a !== mountPos)
      ) {
        console.error(
          "rb-anlz-spike: too many arguments (usage: [drive] snapshot|compare)",
        );
        process.exitCode = 2;
        return;
      }
      if (modeWord === undefined) {
        console.error("rb-anlz-spike: mode is required (snapshot|compare)");
        process.exitCode = 2;
        return;
      }
      const tag = flags.strings.get("tag") ?? "";
      if (!tag) {
        console.error(
          "rb-anlz-spike: --tag=<label> is required (names the baseline file)",
        );
        process.exitCode = 2;
        return;
      }
      const mount = mountFrom(mountPos);
      const json = flags.bools.has("json");
      const { anlzSpike, printSpikeReport } = await import("./anlz-spike");
      const r = anlzSpike({
        mount,
        tag,
        mode,
        json,
        log: (s) => (json ? undefined : console.log(s)),
      });
      if (json) {
        console.log(JSON.stringify(r));
      } else {
        printSpikeReport(r, console.log);
      }
      if (!r.ok) process.exitCode = 1;
      return;
    }
    case "rb-grid-triage": {
      // GA-03 triage + GA-04 completion: decode the collection ANLZ
      // grid, byte-compare against a stick (--compare), and audit our
      // fitted ledger grids against what rekordbox actually wrote.
      // Read-only — no pgrep guard needed (only writes need it).
      const flags = parseFlags(rest, ["limit", "compare"], ["json"]);
      const limit = nonNegOpt(flags, "limit", "rb-grid-triage");
      // `--limit` present but invalid: nonNegOpt printed the error and
      // set exit 2 — bail with zero work (the nonNegOpt contract).
      if (flags.strings.has("limit") && limit === undefined) return;
      const rawCompare = flags.strings.get("compare");
      if (rawCompare === "") {
        console.error("rb-grid-triage: --compare= requires a drive name");
        process.exitCode = 2;
        return;
      }
      // `--compare DJMASTER` (string value), bare `--compare` (default to
      // the configured master drive), or absent (undefined = no compare).
      const compareDrive =
        rawCompare !== undefined
          ? rawCompare
          : rest.includes("--compare")
            ? (process.env.MEGADJ_MASTER_DRIVE ?? "DJMASTER")
            : undefined;
      const mount = mountFrom(
        positionalArgs(rest, ["limit", "compare"]).find(
          (a) => a !== "snapshot" && a !== "compare",
        ),
      );
      const json = flags.bools.has("json");
      const state = new ArchiveState(DB_PATH);
      try {
        const { gridTriage, printGridTriageReport } =
          await import("./grid-triage");
        const r = await gridTriage({
          mount,
          state,
          limit,
          compareDrive,
          json,
          log: (s) => (json ? undefined : console.log(s)),
        });
        if (json) {
          console.log(JSON.stringify(r));
        } else {
          printGridTriageReport(r, console.log);
        }
        if (!r.ok) process.exitCode = 1;
      } finally {
        state.close();
      }
      return;
    }
  }
}
