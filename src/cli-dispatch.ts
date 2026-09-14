import type { CliCommandHandler, CliContext } from "./cli-command";
import { ANALYSIS_COMMANDS } from "./cli-commands-analysis";
import { CORE_COMMANDS } from "./cli-commands-core";
import { SHELF_COMMANDS } from "./cli-commands-shelf";
import { TAG_COMMANDS } from "./cli-commands-tags";

const COMMANDS: Readonly<Record<string, CliCommandHandler>> = {
  ...CORE_COMMANDS,
  ...SHELF_COMMANDS,
  ...TAG_COMMANDS,
  ...ANALYSIS_COMMANDS,
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
