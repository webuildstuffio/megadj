/**
 * megadj stem-overcue — build OverCue bundles on FIKWOK using XZ Mods backend.
 *
 * Full pipeline: scans Demucs stem cache → resolves rekordbox paths →
 * calls grouped_stems.py + overcue_flac_pack.py in parallel →
 * writes CDJMODS/ bundles with 3x+ speedup (32s eff vs 120s v1).
 *
 * Usage:
 *   megadj stem-overcue [VOLUME] [--limit N] [--start N] [--workers N]
 *                       [--dry-run] [--json] [--status]
 *
 * Requires: XZ Mods Beta app installed, import-python env set up.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { parseJsonOrNull } from "../../shared/leaf/guards";
import { commandLog } from "../../shared/progress";
import { writeJson } from "../../shared/cli-output";

export interface StemOvercueOptions {
  volume: string;
  limit?: number | undefined;
  start?: number | undefined;
  workers?: number | undefined;
  dryRun?: boolean | undefined;
  json?: boolean | undefined;
  status?: boolean | undefined;
  onProgress?: ((msg: string) => void) | undefined;
}

const XZ_RESOURCES = "/Applications/XZ Mods Beta.app/Contents/Resources/resources";
const IMPORT_PYTHON = `${process.env.HOME}/.local/share/XZ Mods/import-python/bin/python`;
const XZ_VENV_PYTHON = `${process.env.HOME}/github/XZ-Mods/.venv/bin/python3`;
const SCRIPT_DIR = dirname(new URL(import.meta.url).pathname);
const TURBO_SCRIPT = join(SCRIPT_DIR, "overcue-turbo.py");
const SCAN_SCRIPT = join(SCRIPT_DIR, "overcue-scan.py");

interface TurboResult {
  ok: number;
  exists: number;
  missing: number;
  failed: number;
  wall_s: number;
  cpu_avg_s: number;
  eff_avg_s: number;
  workers: number;
  total_indexed: number;
}

function checkPrereqs(): string | null {
  if (!existsSync(XZ_RESOURCES))
    return "XZ Mods Beta app not installed at /Applications/XZ Mods Beta.app";
  if (!existsSync(IMPORT_PYTHON)) return "Import Python env not set up (run XZ Mods app first)";
  if (!existsSync(TURBO_SCRIPT)) return `Pipeline script missing: ${TURBO_SCRIPT}`;
  if (!existsSync(SCAN_SCRIPT)) return `Scan script missing: ${SCAN_SCRIPT}`;
  return null;
}

function readIndex(volume: string): { indexed: number; bundles: number } {
  const cdjmodsDir = join(volume, "CDJMODS");
  const indexPath = join(cdjmodsDir, "index.json");
  const stemsDir = join(cdjmodsDir, "stems");
  const raw = existsSync(indexPath)
    ? (parseJsonOrNull(readFileSync(indexPath, "utf8")) as {
        tracks?: Record<string, unknown>;
      } | null)
    : null;
  const indexed = raw !== null ? Object.keys(raw.tracks ?? {}).length : 0;
  const bundles = existsSync(stemsDir)
    ? readdirSync(stemsDir).filter((d) => existsSync(join(stemsDir, d, "overcue-manifest.json")))
        .length
    : 0;
  return { indexed, bundles };
}

function scanMapping(
  volume: string,
  stemsSubdir: string,
): { mappingPath: string; count: number } | null {
  const mappingPath = `/tmp/megadj-overcue-mapping-${Date.now()}.json`;

  const result = spawnSync(
    XZ_VENV_PYTHON,
    [SCAN_SCRIPT, volume, stemsSubdir, mappingPath, "--skip-indexed"],
    {
      cwd: `${process.env.HOME}/github/XZ-Mods`,
      env: {
        ...process.env,
        VIRTUAL_ENV: `${process.env.HOME}/github/XZ-Mods/.venv`,
        PATH: `${process.env.HOME}/github/XZ-Mods/.venv/bin:${process.env.PATH}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
    },
  );

  const stdout = result.stdout?.toString() ?? "";
  const lastLine = stdout
    .split("\n")
    .filter((l) => l.trim())
    .pop();
  const parsed = lastLine ? (parseJsonOrNull(lastLine) as { count?: number } | null) : null;

  if (result.status !== 0 || parsed === null) {
    return null;
  }
  return { mappingPath, count: parsed.count ?? 0 };
}

export async function stemOvercue(opts: StemOvercueOptions): Promise<void> {
  const log = commandLog(opts);
  const { volume } = opts;

  if (!existsSync(volume)) {
    log(`stem-overcue: volume not found: ${volume}`);
    if (opts.json) await writeJson({ command: "stem-overcue", error: "volume not found" });
    return;
  }

  if (opts.status) {
    const { indexed, bundles } = readIndex(volume);
    log(`stem-overcue status:`);
    log(`  Volume: ${volume}`);
    log(`  Indexed: ${indexed} tracks`);
    log(`  Bundles: ${bundles}`);
    if (opts.json) {
      await writeJson({ command: "stem-overcue", status: true, indexed, bundles, volume });
    }
    return;
  }

  const prereqError = checkPrereqs();
  if (prereqError) {
    log(`stem-overcue: ${prereqError}`);
    if (opts.json) await writeJson({ command: "stem-overcue", error: prereqError });
    return;
  }

  const stemsSubdir = "stems";
  log(`stem-overcue: scanning ${basename(volume)}/${stemsSubdir} for stems...`);
  const scan = scanMapping(volume, stemsSubdir);
  if (scan === null || scan.count === 0) {
    log(`stem-overcue: no processable tracks found`);
    if (opts.json)
      await writeJson({ command: "stem-overcue", error: "no processable tracks", volume });
    return;
  }

  const limit = opts.limit ?? scan.count;
  const start = opts.start ?? 0;
  const workers = opts.workers ?? 3;

  if (opts.dryRun) {
    log(
      `stem-overcue: would process ${Math.min(limit, scan.count)} of ${scan.count} tracks (${workers} workers) on ${basename(volume)}`,
    );
    if (opts.json) {
      await writeJson({
        command: "stem-overcue",
        dryRun: true,
        processable: scan.count,
        limit,
        start,
        workers,
        volume,
      });
    }
    return;
  }

  log(
    `stem-overcue: processing ${Math.min(limit, scan.count)} tracks (${workers} workers, start=${start}) on ${basename(volume)}`,
  );

  const env = {
    ...process.env,
    XZ_BUILDER_RESOURCES: XZ_RESOURCES,
    XZ_AUDIO_HELPER: join(XZ_RESOURCES, "xz-audio-helper"),
    XZ_OVERCUE_CHECK: join(XZ_RESOURCES, "xz-overcue-check"),
    XZ_WORKERS: String(workers),
    VIRTUAL_ENV: `${process.env.HOME}/github/XZ-Mods/.venv`,
    PATH: `${process.env.HOME}/github/XZ-Mods/.venv/bin:${process.env.PATH}`,
  };

  const result = spawnSync(
    XZ_VENV_PYTHON,
    [TURBO_SCRIPT, scan.mappingPath, volume, String(limit), String(start), String(workers)],
    {
      cwd: `${process.env.HOME}/github/XZ-Mods`,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: Math.max(limit * 120, 3600) * 1000,
    },
  );

  const stdout = result.stdout?.toString() ?? "";
  const stderr = result.stderr?.toString() ?? "";

  for (const line of stdout.split("\n")) {
    if (line.trim()) log(`  ${line}`);
  }
  if (stderr.trim()) {
    for (const line of stderr.split("\n").slice(0, 5)) {
      if (line.trim()) log(`  stderr: ${line}`);
    }
  }

  let turboResult: TurboResult | null = null;
  for (const line of stdout.split("\n").toReversed()) {
    if (line.startsWith("RESULT:")) {
      turboResult = parseJsonOrNull(line.slice(7)) as TurboResult | null;
      break;
    }
  }

  const { indexed } = readIndex(volume);

  if (turboResult !== null) {
    log(
      `\nstem-overcue: ${turboResult.ok} built, ${turboResult.exists} cached, ${turboResult.failed} failed`,
    );
    if (turboResult.ok > 0) {
      log(
        `  ${turboResult.eff_avg_s}s/track effective (${turboResult.workers} workers, ${(120 / turboResult.eff_avg_s).toFixed(1)}x vs v1)`,
      );
    }
    log(`  total indexed: ${indexed}`);
  }

  if (opts.json) {
    await writeJson({
      command: "stem-overcue",
      ...(turboResult ?? { ok: 0, failed: 0, missing: 0, exists: 0 }),
      indexed,
      volume,
      exitCode: result.status ?? 1,
    });
  }
}
