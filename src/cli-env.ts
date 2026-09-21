// cli-env.ts — the env-resolved constants cli.ts and its case modules
// share (music dir, DB path). Split from cli.ts so case runners can use
// them without importing the dispatcher.
//
// Every path read goes through nonEmptyEnv (#281): `MEGADJ_MUSIC_DIR="$SHELF"`
// with $SHELF unset expands to the empty string, and `??` only catches
// undefined — the empty value then resolved CWD-relative and dropped a
// dated batch folder in the repo root. Present-but-empty is a typo, never
// an override.
import { nonEmptyEnv } from "./shared/leaf/guards";

export const MUSIC_DIR =
  nonEmptyEnv("MEGADJ_MUSIC_DIR") ?? `${process.env.HOME}/Music/DJ-Imports`;
export const DB_PATH =
  nonEmptyEnv("MEGADJ_DB") ??
  `${process.env.HOME}/.local/state/megadj/archive.db`;
export const COOKIES = nonEmptyEnv("MEGADJ_COOKIES") ?? "chrome";
export const COOKIES_FILE = nonEmptyEnv("MEGADJ_COOKIES_FILE") ?? null;
