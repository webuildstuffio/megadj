/**
 * maintenance-cmds.ts — the shelf-maintenance command cases for cli.ts
 * (file-length guard: cli.ts sits at the 800-line cap; these cases
 * live here as one unit, same seam as the old shelf_cmds.ts). Pure
 * flag-parsing + dynamic import + delegation — all logic lives in
 * src/commands/shelf-hygiene.ts, rb-fix-paths.ts, and grid-triage.ts.
 */

import { DB_PATH } from "../cli-env";
import { ArchiveState } from "../state";

export async function runMaintenanceCommand(
  command: string,
  rest: string[],
): Promise<void> {
  switch (command) {
    case "shelf-hygiene": {
      // Detect → ledger → review → apply → validate (the shelf-hygiene
      // feature, CLI half; the web queue lives in CrateDeck). Findings
      // live in the archive DB — the SSOT every surface reads.
      const json = rest.includes("--json");
      const apply = rest.includes("--apply");
      const yes = rest.includes("--yes");
      const many = (key: string): string[] =>
        rest
          .filter((a) => a.startsWith(`--${key}=`))
          .map((a) => a.slice(key.length + 3))
          .filter((v): v is string => v.length > 0);
      const { shelfHygiene } = await import("./shelf-hygiene");
      await shelfHygiene({
        json,
        apply,
        yes,
        confirm: many("confirm"),
        dismiss: many("dismiss"),
        kind: many("kind")[0],
        shelfVolume: many("shelf")[0],
      });
      return;
    }
    case "rb-fix-paths": {
      // rekordbox library repair: stale djmdContent.FolderPath rows after
      // folder moves/merges. Dry-run by default; --apply --yes rewrites
      // rows (backs the DB up first, refuses while rekordbox runs).
      const json = rest.includes("--json");
      const apply = rest.includes("--apply");
      const yes = rest.includes("--yes");
      const positional = rest.filter((a) => !a.startsWith("--"))[0];
      const shelfVolume = process.env.MEGADJ_SHELF_VOLUME ?? "SHELF1";
      const mount = positional
        ? positional.startsWith("/Volumes/")
          ? positional
          : `/Volumes/${positional}`
        : `/Volumes/${shelfVolume}`;
      const { rbFixPaths, printRbFixReport } = await import("./rb-fix-paths");
      const r = await rbFixPaths({
        mount,
        apply,
        yes,
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
      const json = rest.includes("--json");
      const mode = rest.includes("compare") ? "compare" : "snapshot";
      const tagRaw = rest.find((a) => a.startsWith("--tag="));
      const tag = tagRaw?.split("=")[1] ?? "";
      const positional = rest.filter(
        (a) => !a.startsWith("--") && a !== "snapshot" && a !== "compare",
      )[0];
      const shelfVolume = process.env.MEGADJ_SHELF_VOLUME ?? "SHELF1";
      const mount = positional
        ? positional.startsWith("/")
          ? positional
          : `/Volumes/${positional}`
        : `/Volumes/${shelfVolume}`;
      if (!tag) {
        console.error(
          "rb-anlz-spike: --tag=<label> is required (names the baseline file)",
        );
        process.exitCode = 2;
        return;
      }
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
      const json = rest.includes("--json");
      const limitRaw = rest.find((a) => a.startsWith("--limit="));
      const limitStr = limitRaw?.split("=")[1] ?? "";
      // strict raw check before Number() — Number("") is 0, and a typo
      // like --limit=abc must never silently mean "all rows"
      const limit = /^\d+$/u.test(limitStr) ? Number(limitStr) : NaN;
      if (limitRaw && !Number.isFinite(limit)) {
        console.error(
          `rb-grid-triage: --limit must be a non-negative number (got "${limitStr}")`,
        );
        process.exitCode = 2;
        return;
      }
      const compareRaw = rest.find((a) => a.startsWith("--compare"));
      const compareVal = compareRaw
        ? compareRaw.includes("=")
          ? compareRaw.split("=")[1]
          : (process.env.MEGADJ_MASTER_DRIVE ?? "DJMASTER")
        : undefined;
      if (compareVal === "") {
        console.error("rb-grid-triage: --compare= requires a drive name");
        process.exitCode = 2;
        return;
      }
      const positional = rest.filter((a) => !a.startsWith("--"))[0];
      const shelfVolume = process.env.MEGADJ_SHELF_VOLUME ?? "SHELF1";
      const mount = positional
        ? positional.startsWith("/")
          ? positional
          : `/Volumes/${positional}`
        : `/Volumes/${shelfVolume}`;
      const state = new ArchiveState(DB_PATH);
      try {
        const { gridTriage, printGridTriageReport } =
          await import("./grid-triage");
        const r = await gridTriage({
          mount,
          state,
          limit: limitRaw ? limit : undefined,
          compareDrive: compareVal,
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
