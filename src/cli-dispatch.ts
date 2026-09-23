// cli-dispatch.ts — the megadj verb→handler seam: the CliContext /
// CliCommandHandler contract (#221: was cli-command.ts, 14L — the types
// live with the one dispatch table they type) plus the spread of the
// domain command records (#235: getdat/shelf/fulltags/rekordbox
// cli-commands.ts — the separate maintenance branch in cli.ts is gone;
// every verb routes through this ONE table).
import type { ArchiveState } from "./core/state";

export interface CliContext {
  state: ArchiveState;
  musicDir: string;
  dbPath: string;
  cookies: string;
  cookiesFile: string | null;
}

export type CliCommandHandler = (
  rest: string[],
  context: CliContext,
) => Promise<void>;

import { GETDAT_COMMANDS } from "./getdat/cli-commands";
import { SHELF_COMMANDS } from "./shelf/cli-commands";
import { FULLTAGS_COMMANDS } from "./fulltags/cli/cli-commands";
import { REKORDBOX_COMMANDS } from "./rekordbox/cli-commands";

const COMMANDS: Readonly<Record<string, CliCommandHandler>> = {
  ...GETDAT_COMMANDS,
  ...SHELF_COMMANDS,
  ...FULLTAGS_COMMANDS,
  ...REKORDBOX_COMMANDS,
};

export async function dispatchCommand(
  command: string,
  rest: string[],
  context: CliContext,
): Promise<boolean> {
  const handler = COMMANDS[command];
  if (!handler) return false;
  await handler(rest, context);
  return true;
}
