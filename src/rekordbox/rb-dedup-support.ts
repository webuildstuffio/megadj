import { isAbsolute, join, relative, sep } from "node:path";

interface MutationPair {
  keepId: string;
  keepPath: string;
  loseId: string;
  losePath: string;
  basis: "same-path" | "path-twin" | "fingerprint";
}

const inContents = (path: string): boolean => /\/Contents(?:\/|$)/u.test(path);

/** Choose the canonical keeper using location, quality, and stable path. */
export function pickKeeper(
  first: { path: string; size: number; bitrate: number },
  second: { path: string; size: number; bitrate: number },
): "a" | "b" {
  if (inContents(first.path) !== inContents(second.path))
    return inContents(first.path) ? "a" : "b";
  if (first.bitrate !== second.bitrate)
    return first.bitrate > second.bitrate ? "a" : "b";
  if (first.size !== second.size) return first.size > second.size ? "a" : "b";
  return first.path <= second.path ? "a" : "b";
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
      errors: [
        `selected Contents root is unavailable: ${error instanceof Error ? error.message : String(error)}`,
      ],
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
          `${role} ${pair[role === "keeper" ? "keepId" : "loseId"]} path cannot be resolved: ${path} (${error instanceof Error ? error.message : String(error)})`,
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
  error?: string | undefined;
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
  if (result.error) {
    log(`error: ${result.error}`);
    return;
  }
  log(
    `${result.scanned} content rows scanned · ${result.pairs.length} dupe pair(s)`,
  );
  for (const pair of result.pairs.slice(0, 20)) {
    log(
      `  ♊ "${pair.title}" (${pair.basis}, Δ${pair.durDelta.toFixed(1)}s)\n     keep ${pair.keepPath}\n     lose ${pair.losePath}`,
    );
  }
  if (result.pairs.length > 20) log(`  … +${result.pairs.length - 20} more`);
  if (result.appliedMode) {
    log(
      `applied: ${result.removed} loser rows deleted, ${result.quarantined.length} files quarantined, ${result.missingFiles.length} already missing · backup: ${result.backedUpTo ?? "none"}`,
    );
  } else if (result.pairs.length) {
    log(
      `dry-run — re-run with --apply --yes (rekordbox quit) to delete ${result.pairs.length} loser rows + quarantine files`,
    );
  } else {
    log("clean — no same-title/duration twins found");
  }
}
