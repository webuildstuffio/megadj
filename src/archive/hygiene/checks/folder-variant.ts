/**
 * Check: folder-variant (§4.2) — same artist filed under variant folder
 * names ("Robin S" vs "Robin S_", separator flips, Unicode hyphens).
 * Token-SET equality over the artist path segment is the auto-detectable
 * class; everything else on the candidate list is human-gated (§3.4:
 * Akn/Ama/Belly/Nelly are different artists — edit distance never merges).
 *
 * Severity: exact token-set equality = "likely" (fp can still arbitrate
 * contents); the human confirms the merge — folders are NEVER auto-
 * merged (a wrong merge renames real albums).
 */
import { dirname, basename } from "node:path";
import type { CheckCtx, CheckDef, Finding, ShelfFile } from "../types";
import { newFindingId } from "../types";
import { nameSimilarityTokens } from "./similarity";

/** Artist folder = the path segment directly under Contents/Artist/…
 *  (artist/album/track). Returns the FIRST segment under Contents. */
function artistOf(path: string, volume: string): string {
  const rel = path.slice(volume.length + 1); // strip /Volumes/X
  const parts = rel.split("/");
  // ["Contents", "Artist", ...] → segment 1
  return parts[1] ?? basename(dirname(path));
}

export const folderVariant: CheckDef = {
  kind: "folder-variant" as const,
  defaultSeverity: "likely" as const,
  detect(files: ShelfFile[], ctx: CheckCtx): Finding[] {
    const now = ctx.now();
    // group artists by their token signature. The collab marker "x" is a
    // SEPARATOR, not a token — "ANOTR x 54 Ultra" and "ANOTR, 54 Ultra"
    // are the same artist (the Sep 9 sweep merged exactly this class).
    const byTokens = new Map<string, Map<string, number>>(); // sig → artist → fileCount
    for (const f of files) {
      const artist = artistOf(f.path, ctx.volume);
      const sig = artist
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t && t !== "x")
        .toSorted()
        .join("+");
      if (!sig) continue;
      const m = byTokens.get(sig);
      if (m) m.set(artist, (m.get(artist) ?? 0) + 1);
      else byTokens.set(sig, new Map([[artist, 1]]));
    }
    const out: Finding[] = [];
    for (const artists of byTokens.values()) {
      if (artists.size < 2) continue;
      const names = [...artists.keys()].toSorted();
      const keeper = names[0]!;
      const renames: Record<string, string> = {};
      for (const v of names.slice(1)) renames[v] = keeper;
      out.push({
        id: newFindingId(),
        kind: "folder-variant",
        severity: "likely",
        status: "open",
        paths: names.map((n) => joinVolume(ctx.volume, n)),
        bytes: names.map((n) => artists.get(n) ?? 0),
        md5s: [],
        fps: [],
        evidence: {
          tokenSignature: names
            .map((n) =>
              n
                .toLowerCase()
                .split(/[^a-z0-9]+/)
                .filter(Boolean)
                .toSorted()
                .join("+"),
            )
            .find((s): s is string => Boolean(s)),
          similarity: nameSimilarityTokens(keeper, names[1] ?? keeper),
          fileCounts: Object.fromEntries(artists),
        },
        proposedAction: {
          type: "merge-folders",
          into: joinVolume(ctx.volume, keeper),
          renames,
        },
        keeperPath: joinVolume(ctx.volume, keeper),
        walkToken: ctx.walkToken,
        autoSafe: false, // folder merges are ALWAYS human-gated
        createdAt: now,
        decidedAt: null,
        appliedAt: null,
        validation: null,
      });
    }
    return out;
  },
};

function joinVolume(volume: string, artist: string): string {
  return `${volume}/Contents/${artist}`;
}
