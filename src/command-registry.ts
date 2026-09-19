/**
 * The megadj CLI help/census source of truth (#143, #214, #239).
 *
 * Command copy lives in cohesive domain leaves. This facade preserves the
 * public registry API and the exact ordering consumed by the help renderer.
 */
import { CRATEDECK_COMMAND_DOCS } from "./command-doc-cratedeck";
import { FULLTAGS_COMMAND_DOCS } from "./command-doc-fulltags";
import { GETDAT_COMMAND_DOCS } from "./command-doc-getdat";
import { REKORDBOX_COMMAND_DOCS } from "./command-doc-rekordbox";
import { SHELF_COMMAND_DOCS } from "./command-doc-shelf";
import type { CommandDocEntry, CommandGroup } from "./command-doc-types";

export type { CommandDocEntry, CommandGroup } from "./command-doc-types";

export const COMMAND_GROUPS: readonly {
  group: CommandGroup;
  tagline: string;
}[] = [
  { group: "getdat", tagline: "pull every track from everywhere" },
  {
    group: "fulltags",
    tagline: "100% accuracy, 100% coverage, zero manual labour",
  },
  {
    group: "cratedeck",
    tagline: "the Crate: organize, sync & verify every DJ USB",
  },
];

export const COMMAND_DOCS: readonly CommandDocEntry[] = [
  ...GETDAT_COMMAND_DOCS.slice(0, 5),
  ...FULLTAGS_COMMAND_DOCS,
  ...CRATEDECK_COMMAND_DOCS.slice(0, 1),
  ...GETDAT_COMMAND_DOCS.slice(5),
  ...SHELF_COMMAND_DOCS,
  ...REKORDBOX_COMMAND_DOCS,
  ...CRATEDECK_COMMAND_DOCS.slice(1),
];

/** Group tagline line (verbatim, for the renderer). */
export function groupHeader(group: CommandGroup): string {
  const meta = COMMAND_GROUPS.find((candidate) => candidate.group === group);
  if (!meta) throw new Error(`unknown command group: ${group}`);
  return `${meta.group} — ${meta.tagline}:`;
}
