/**
 * maintenance_cmds.ts — the shelf-maintenance command cases for cli.ts
 * (file-length guard: cli.ts sits at the 800-line cap; these two cases
 * live here as one unit, same seam as the old shelf_cmds.ts). Pure
 * flag-parsing + dynamic import + delegation — all logic lives in
 * src/commands/shelf-hygiene.ts and rb_fix_paths.ts.
 */

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
      const { rbFixPaths, printRbFixReport } = await import("./rb_fix_paths");
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
  }
}
