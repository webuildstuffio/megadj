export type CommandGroup = "getdat" | "fulltags" | "cratedeck";

export interface CommandDocEntry {
  /** The verb token (census surface — unique per family spellings). */
  name: string;
  group: CommandGroup;
  /** Verbatim help lines for this entry (usage + description). */
  block: string[];
}
