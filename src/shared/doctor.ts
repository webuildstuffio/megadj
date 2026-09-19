/**
 * doctor.ts — `megadj doctor` / `megadj init`.
 *
 * doctor: one-shot diagnostics for every external dependency, env var, and
 * config value the toolkit needs. Exits 1 if anything required is broken so
 * it works as a CI/job gate too.
 *
 * init: first-run bootstrap — writes cratedeck/config.toml from the sample
 * (never overwrites an existing one), then runs doctor.
 *
 * The individual probes live in doctor-checks.ts (#42 item 2 split); the
 * DB-state checks (cue kinds, dupes, playlist XML) live in doctor-state.ts.
 * This module is the runner: check order, output formats, exit codes. The
 * CheckResult shape (was doctor-types.ts, 9L — merged per #221) lives here:
 * it is the result type of the checks this module owns.
 */
import { existsSync, readFileSync, copyFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CRATEDECK_DIR,
  applyDriveNames,
  checkBun,
  checkCookies,
  checkCrateConfig,
  checkFfmpeg,
  checkMusicDir,
  checkOpenrouter,
  checkPlatform,
  checkPyrekordbox,
  checkUvPython,
  checkYtdlp,
  checkYtdlpImpersonate,
  detectVolumes,
} from "./doctor-checks";
import {
  checkCueKinds,
  checkDupes,
  checkPlaylistXml,
  masterDbPath,
} from "./doctor-state";

export interface CheckResult {
  id: string;
  label: string;
  /** required = toolkit unusable without it; optional = feature-scoped. */
  required: boolean;
  ok: boolean;
  detail: string;
  fix?: string | undefined;
}

export function runDoctor(): CheckResult[] {
  const dbPath = masterDbPath(mountArg());
  return [
    checkPlatform(),
    checkBun(),
    checkFfmpeg(),
    checkYtdlp(),
    checkYtdlpImpersonate(),
    checkUvPython(),
    checkPyrekordbox(),
    checkOpenrouter(),
    checkCookies(),
    checkCrateConfig(),
    checkMusicDir(),
    // postmortem §3b exit gates (state checks; skip honestly when the
    // drive is unmounted or rekordbox is open)
    checkCueKinds(dbPath),
    checkDupes(dbPath),
    checkPlaylistXml(dbPath),
  ];
}

/** The positional drive arg the user passed to doctor (SHELF1 or a path). */
function mountArg(): string | undefined {
  const argv = process.argv.slice(3).filter((a) => !a.startsWith("--"));
  return argv[0];
}

// ---- output -----------------------------------------------------------------
const MARK = { pass: "✓", warn: "▲", fail: "✕" } as const;

function markFor(c: CheckResult): keyof typeof MARK {
  return c.ok ? "pass" : c.required ? "fail" : "warn";
}

export function printDoctor(results: CheckResult[]): number {
  const broken = results.filter((c) => !c.ok && c.required);
  const warn = results.filter((c) => !c.ok && !c.required);
  const oks = results.filter((c) => c.ok);

  console.log(
    `megadj doctor — ${oks.length} ok, ${warn.length} optional, ${broken.length} broken\n`,
  );
  for (const c of results) {
    const m = markFor(c);
    console.log(`${MARK[m]} ${c.label}: ${c.detail}`);
    if (!c.ok && c.fix) console.log(`   fix: ${c.fix}`);
  }
  console.log("");
  if (broken.length) {
    console.log(
      `${broken.length} required check(s) failing — fix those first.`,
    );
  } else {
    console.log(
      "All required checks pass. Optional gaps only narrow features:",
    );
    console.log("  · pyrekordbox  → CrateDeck dual-DB reads");
    console.log(
      "  · OPENROUTER_API_KEY → AI genre/year fill + artwork generation",
    );
  }
  return broken.length ? 1 : 0;
}

export function doctorJson(results: CheckResult[]): string {
  const broken = results.filter((c) => !c.ok && c.required).length;
  return JSON.stringify(
    {
      ok: broken === 0,
      required_broken: broken,
      checks: results.map((c) => ({ ...c, fix: c.ok ? undefined : c.fix })),
    },
    null,
    2,
  );
}

// ---- init -------------------------------------------------------------------
// detectVolumes + applyDriveNames moved to doctor-checks.ts (#210 — pure
// helpers live beside the probes; doctor.ts keeps only orchestration).

export function runInit(): number {
  const sample = join(CRATEDECK_DIR, "config.sample.toml");
  const target = join(CRATEDECK_DIR, "config.toml");
  let didScaffold = false;
  if (existsSync(target)) {
    console.log(`cratedeck/config.toml already exists — leaving it alone`);
  } else if (existsSync(sample)) {
    copyFileSync(sample, target);
    didScaffold = true;
    console.log(`✓ scaffolded cratedeck/config.toml from config.sample.toml`);
  } else {
    console.log(
      `! config.sample.toml not found at ${sample} — skipping scaffold`,
    );
  }

  // Auto-detect mounted USB volumes and write them into the scaffolded config
  // so the very first run works without hand-editing. Only two (or one, when
  // mirror just mirrors master) mounted non-system volumes → unambiguous.
  if (didScaffold) {
    const vols = detectVolumes();
    const candidates = vols.filter(
      (v) => !v.startsWith("com.apple.") && !v.startsWith("Time Machine"),
    );
    if (candidates.length === 2) {
      const [master, mirror] = candidates as [string, string];
      const cfg = readFileSync(target, "utf8");
      const next = applyDriveNames(cfg, master, mirror);
      if (next !== cfg) {
        writeFileSync(target, next);
        console.log(
          `✓ detected mounted volumes → master_drive="${master}", mirror_drive="${mirror}"`,
        );
        didScaffold = false; // fully configured; skip the "edit it" hint
      }
    } else if (candidates.length > 2) {
      console.log(
        `! ${candidates.length} volumes mounted (${candidates.join(", ")}) — edit cratedeck/config.toml to pick master/mirror`,
      );
    }
  }

  const results = runDoctor();
  const code = printDoctor(results);
  // one-time env starter: copy the commented example if no real .env exists
  const envFile = join(CRATEDECK_DIR, "..", ".env");
  if (!existsSync(envFile)) {
    copyFileSync(join(CRATEDECK_DIR, "..", ".env.example"), envFile);
    console.log(`✓ copied .env.example → .env (uncomment what you need)`);
  }
  if (didScaffold) {
    console.log(
      `next: edit cratedeck/config.toml → set master_drive/mirror_drive to your USB volume names, then re-run \`megadj doctor\``,
    );
  }
  return code;
}
