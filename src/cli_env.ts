// cli_env.ts — the env-resolved constants cli.ts and its case modules
// share (music dir, DB path). Split from cli.ts so case runners can use
// them without importing the dispatcher.
export const MUSIC_DIR =
  process.env.MEGADJ_MUSIC_DIR ?? `${process.env.HOME}/Music/DJ-Imports`;
export const DB_PATH =
  process.env.MEGADJ_DB ?? `${process.env.HOME}/.local/state/megadj/archive.db`;
export const COOKIES = process.env.MEGADJ_COOKIES ?? "chrome";
export const COOKIES_FILE = process.env.MEGADJ_COOKIES_FILE ?? null;
