import { isAbsolute, join, relative, sep } from "node:path";
import { pickRbKeeper } from "../shared/keeper";
import { printResult } from "./rb-command-kit.js";
import { errorText } from "../shared/error-text";

interface MutationPair {
  keepId: string;
  keepPath: string;
  loseId: string;
  losePath: string;
  basis: "same-path" | "path-twin" | "fingerprint";
}

/** Choose the canonical keeper using location, quality, and stable path.
 * Delegates to the shared tier policy (#158) — one comparator home, this
 * export keeps the rb-dedup surface stable for tests and callers. */
export function pickKeeper(
  first: { path: string; size: number; bitrate: number },
  second: { path: string; size: number; bitrate: number },
): "a" | "b" {
  return pickRbKeeper(first, second);
}

export function inspectMutationPaths(
  mount: string,
  pairs: MutationPair[],
  realpath: (path: string) => string,
): { errors: string[]; sharedLoserIds: Set<string> } {
  let contentsRoot: string;
  try {
    contentsRoot = realpath(join(mount, "Contents"));
  } catch (error) {
    return {
      errors: [`selected Contents root is unavailable: ${errorText(error)}`],
      sharedLoserIds: new Set(),
    };
  }
  const errors: string[] = [];
  const sharedLoserIds = new Set<string>();
  for (const pair of pairs) {
    const resolvedPaths = new Map<"keeper" | "loser", string>();
    for (const [role, path] of [
      ["keeper", pair.keepPath],
      ["loser", pair.losePath],
    ] as const) {
      let resolved: string;
      try {
        resolved = realpath(path);
      } catch (error) {
        errors.push(
          `${role} ${pair[role === "keeper" ? "keepId" : "loseId"]} path cannot be resolved: ${path} (${errorText(error)})`,
        );
        continue;
      }
      resolvedPaths.set(role, resolved);
      const rel = relative(contentsRoot, resolved);
      if (
        rel === "" ||
        rel === ".." ||
        rel.startsWith(`..${sep}`) ||
        isAbsolute(rel)
      ) {
        errors.push(
          `${role} ${pair[role === "keeper" ? "keepId" : "loseId"]} is outside selected Contents root: ${resolved}`,
        );
      }
    }
    const keeperResolved = resolvedPaths.get("keeper");
    const loserResolved = resolvedPaths.get("loser");
    if (
      keeperResolved !== undefined &&
      loserResolved !== undefined &&
      (pair.basis === "same-path" ||
        pair.basis === "path-twin" ||
        keeperResolved === loserResolved)
    ) {
      sharedLoserIds.add(pair.loseId);
    }
  }
  return { errors, sharedLoserIds };
}

interface DedupReport {
  error?: string;
  scanned: number;
  pairs: (MutationPair & { title: string; durDelta: number })[];
  appliedMode: boolean;
  removed: number;
  quarantined: string[];
  missingFiles: string[];
  backedUpTo: string | null;
}

export function printRbDedupReport(
  result: DedupReport,
  log: (message: string) => void,
): void {
  printResult(log, result, (body) => {
    log(
      `${body.scanned} content rows scanned · ${body.pairs.length} dupe pair(s)`,
    );
    for (const pair of body.pairs.slice(0, 20)) {
      log(
        `  ♊ "${pair.title}" (${pair.basis}, Δ${pair.durDelta.toFixed(1)}s)\n     keep ${pair.keepPath}\n     lose ${pair.losePath}`,
      );
    }
    if (body.pairs.length > 20) log(`  … +${body.pairs.length - 20} more`);
    if (body.appliedMode) {
      log(
        `applied: ${body.removed} loser rows deleted, ${body.quarantined.length} files quarantined, ${body.missingFiles.length} already missing · backup: ${body.backedUpTo ?? "none"}`,
      );
    } else if (body.pairs.length) {
      log(
        `dry-run — re-run with --apply --yes (rekordbox quit) to delete ${body.pairs.length} loser rows + quarantine files`,
      );
    } else {
      log("clean — no same-title/duration twins found");
    }
  });
}
