import { $ } from "bun";
import { afterAll } from "bun:test";

/** Shared scaffolding for the analysis stage tests: a per-run tmp dir,
 *  its cleanup, and a sine-wave fixture generator. */
export const DIR = `/tmp/fulltags-analysis-test-${process.pid}`;

afterAll(async () => {
  await $`rm -rf ${DIR}`.quiet().nothrow();
});

export async function makeFile(name: string, secs = 3): Promise<string> {
  await $`mkdir -p ${DIR}`.quiet();
  const p = `${DIR}/${name}`;
  await $`ffmpeg -y -hide_banner -loglevel error -f lavfi -i sine=frequency=440:duration=${secs} ${p}`.quiet();
  return p;
}
