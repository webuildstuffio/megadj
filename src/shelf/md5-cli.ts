/** Read a digest from macOS md5; null means the bytes were not verified. */
export function md5Cli(path: string): string | null {
  const result = Bun.spawnSync(["md5", "-q", path]);
  if (result.exitCode !== 0) return null;
  const hash = result.stdout.toString().trim();
  return hash.length > 0 ? hash : null;
}
