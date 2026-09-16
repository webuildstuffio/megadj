/** Fail the local quality gate when Git tracks a path its ignore policy forbids. */

import { writeJson } from "../src/shared/cli-output";

export interface RepoHygieneResult {
  ok: boolean;
  trackedIgnored: string[];
}

export function repoHygiene(cwd = process.cwd()): RepoHygieneResult {
  const proc = Bun.spawnSync({
    cmd: ["git", "ls-files", "-ci", "--exclude-standard", "-z"],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) {
    const detail = proc.stderr.toString().trim();
    throw new Error(
      `repo hygiene: git inventory failed${detail ? `: ${detail}` : ""}`,
    );
  }
  const trackedIgnored = proc.stdout
    .toString()
    .split("\0")
    .filter((path) => path.length > 0)
    .toSorted();
  return { ok: trackedIgnored.length === 0, trackedIgnored };
}

if (import.meta.main) {
  const result = repoHygiene();
  const json = process.argv.includes("--json");
  if (json) {
    // The awaited writeJson seam (#159/#53): a raw console.log here is
    // fire-and-forget — on a piped/file consumer the process can exit
    // before the tail flushes, truncating the summary JSON.
    await writeJson({ command: "repo-hygiene", ...result });
  } else if (result.ok) {
    console.log("repo hygiene: clean (no tracked files match ignore policy)");
  } else {
    console.error("repo hygiene: tracked files match ignore policy:");
    for (const path of result.trackedIgnored) console.error(`  ${path}`);
  }
  if (!result.ok) process.exitCode = 1;
}
