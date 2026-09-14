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
