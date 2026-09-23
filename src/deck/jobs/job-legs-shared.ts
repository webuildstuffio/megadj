/** Await a CLI job leg's exit and convert a failure to a thrown error
 *  with the stderr tail (#316: fetch + intake legs each rebuilt this
 *  cancel/exit/suffix shape). */
export async function awaitLegExit(
  proc: Bun.Subprocess,
  handle: { cancelled: boolean },
  commandLabel: string,
  errOut: string,
): Promise<void> {
  await proc.exited;
  if (handle.cancelled) throw new Error("cancelled");
  if (proc.exitCode !== 0) {
    const suffix = errOut.trim() ? `: ${errOut.trim().slice(-400)}` : "";
    throw new Error(`${commandLabel} exited ${proc.exitCode}${suffix}`);
  }
}
