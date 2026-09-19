import type { CliCommandHandler, CliContext } from "./cli-command";
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
