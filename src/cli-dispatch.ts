// cli-dispatch.ts — the megadj verb→handler seam: the CliContext /
// CliCommandHandler contract (#221: was cli-command.ts, 14L — the types
// live with the one dispatch table they type) plus the spread of the
// three domain command records (getdat/shelf/fulltags cli-commands.ts).
import type { ArchiveState } from "./archive/state";

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
import { FULLTAGS_COMMANDS } from "./fulltags/cli-commands";

const COMMANDS: Readonly<Record<string, CliCommandHandler>> = {
  ...GETDAT_COMMANDS,
  ...SHELF_COMMANDS,
  ...FULLTAGS_COMMANDS,
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
