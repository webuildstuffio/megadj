/**
 * shelf_cmds.ts — the shelf-family command cases for cli.ts (file-length
 * guard: cli.ts sits at the 800-line cap; these five cases moved here as
 * one unit). Pure flag-parsing + dynamic import + delegation — all logic
 * lives in src/commands/shelf-*.ts, as before. MUSIC_DIR mirrors cli.ts's
 * env contract (same expression; cli.ts keeps its own copy).
 */

const MUSIC_DIR =
  process.env.MEGADJ_MUSIC_DIR ?? `${process.env.HOME}/Music/DJ-Imports`;

export async function runShelfCommand(
  command: string,
  rest: string[],
): Promise<boolean> {
  switch (command) {
    case "shelf-sync": {
      // shelf master = the archive-grade HDD; sticks only mirror FROM it.
      // Volume names come from config.toml [library] via env overrides —
      // never hardcoded literals (AGENTS.md rule).
      const json = rest.includes("--json");
      const dryRun = rest.includes("--dry-run");
      const shelfVolume = process.env.MEGADJ_SHELF_VOLUME ?? "SHELF1";
      const stickVolumes = [
        process.env.USB_SYNC_MASTER ?? "DJMASTER",
        process.env.USB_SYNC_MIRROR ?? "DJMIRROR",
      ];
      const { shelfSync } = await import("./shelf-sync");
      await shelfSync({
        musicDir: MUSIC_DIR,
        shelfVolume: `/Volumes/${shelfVolume}`,
        stickVolumes: stickVolumes.map((v) => `/Volumes/${v}`),
        dryRun,
        json,
      });
      return true;
    }
    case "shelf-archive": {
      // The intake sweep: drive(s) → shelf, additive + verified. The
      // generalization of the Sep 9 2026 three-stick manual merge.
      const json = rest.includes("--json");
      const dryRun = rest.includes("--dry-run");
      const deep = rest.includes("--deep");
      const trashes = rest.includes("--trashes");
      const intoEq = rest.find((a) => a.startsWith("--into="));
      const into = intoEq ? decodeURIComponent(intoEq.slice(7)) : undefined;
      const shelfVolume = process.env.MEGADJ_SHELF_VOLUME ?? "SHELF1";
      const suffixEq = rest.find((a) => a.startsWith("--suffix="));
      const suffix = suffixEq ? suffixEq.slice(9) : undefined;
      // positional volumes; default to the configured master+mirror when
      // none are named (the "did both sticks fully land?" check)
      const master = process.env.USB_SYNC_MASTER ?? "DJMASTER";
      const mirror = process.env.USB_SYNC_MIRROR ?? "DJMIRROR";
      const positionals = rest.filter(
        (a) => !a.startsWith("--") && a !== "shelf-archive",
      );
      const volumes = positionals.length ? positionals : [master, mirror];
      const { shelfArchive } = await import("./shelf-archive");
      await shelfArchive({
        volumes: volumes.map((v) =>
          v.startsWith("/Volumes/") ? v : `/Volumes/${v}`,
        ),
        shelfVolume: `/Volumes/${shelfVolume}`,
        into,
        trashes,
        deep,
        suffix,
        dryRun,
        json,
      });
      return true;
    }
    case "shelf-dedupe": {
      const apply = rest.includes("--apply");
      const yes = rest.includes("--yes");
      const json = rest.includes("--json");
      const { shelfDedupe } = await import("./shelf-dedupe");
      await shelfDedupe({ apply, yes, json });
      return true;
    }
    case "shelf-dupescan": {
      const json = rest.includes("--json");
      const quarantine = rest.includes("--quarantine");
      const yes = rest.includes("--yes");
      const onlyIdentical = rest.includes("--only-identical");
      const { shelfDupescan } = await import("./shelf-dupescan");
      await shelfDupescan({ json, quarantine, yes, onlyIdentical });
      return true;
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
      return true;
    }
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
      return true;
    }
    default:
      return false;
  }
}
