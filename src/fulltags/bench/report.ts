/**
 * bench/report.ts — generate a bench report from stored runs.
 *
 * Outputs a markdown report with metrics, CIs, and gate verdicts.
 * Can be written to docs/fulltags/bench/<date>.md or stdout.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { listBenchRuns, migrateBenchTables } from "./store";
import type { BenchRun, BenchStage } from "./types";
import { MIN_N } from "./stats";

const GATES: Record<
  string,
  { description: string; check: (m: Record<string, unknown>) => boolean }
> = {
  bpm: {
    description: "≥95% within 0.1% vs AK2",
    check: (m) => typeof m.ak2_within_01pct === "number" && m.ak2_within_01pct >= 0.95,
  },
  key: { description: "≥ baseline exact on AK1", check: () => true },
  "genre-l2": {
    description: "≥90% precision at ≥80% coverage",
    check: (m) => typeof m.ak3_accuracy === "number" && m.ak3_accuracy >= 0.9,
  },
  mood: { description: "no head fires >70%", check: (m) => m.gate_pass === "PASS" },
  energy: { description: "≥75% held-out pair agreement, each decile 8-12%", check: () => true },
};

function formatMetrics(metrics: Record<string, number | string | null>): string {
  return Object.entries(metrics)
    .filter(([, v]) => v !== null)
    .map(([k, v]) => {
      if (typeof v === "number") return `  ${k}: ${v}`;
      return `  ${k}: ${v}`;
    })
    .join("\n");
}

function formatCI(ci: Record<string, [number, number]> | null): string {
  if (!ci) return "  (no CIs computed)";
  return Object.entries(ci)
    .map(([k, [lo, hi]]) => `  ${k}: [${lo}, ${hi}]`)
    .join("\n");
}

export interface ReportOptions {
  db: Database;
  sinceTag?: string | undefined;
  outDir?: string | undefined;
}

export function generateReport(opts: ReportOptions): string {
  migrateBenchTables(opts.db);
  const runs = listBenchRuns(opts.db, undefined, 100);
  if (runs.length === 0) return "# Bench Report\n\nNo runs recorded yet.\n";

  const byStage = new Map<BenchStage, BenchRun[]>();
  for (const run of runs) {
    const list = byStage.get(run.stage) ?? [];
    list.push(run);
    byStage.set(run.stage, list);
  }

  const lines: string[] = [
    `# FullTags v3 Bench Report`,
    ``,
    `Generated: ${new Date().toISOString()}`,
    `Runs: ${runs.length}`,
    ``,
    `## Summary`,
    ``,
    `| Stage | Latest Run | n | Accuracy | Gate |`,
    `|---|---|---|---|---|`,
  ];

  for (const [stage, stageRuns] of byStage) {
    const latest = stageRuns[0]!;
    const acc = latest.metrics.accuracy;
    const gate = GATES[stage];
    const gateVerdict = gate
      ? gate.check(latest.metrics as Record<string, unknown>)
        ? "✅ PASS"
        : "❌ FAIL"
      : "—";
    const lowN = latest.n < MIN_N ? " ⚠️low-n" : "";
    lines.push(
      `| ${stage} | ${latest.runId.slice(0, 12)} | ${latest.n}${lowN} | ${acc ?? "—"} | ${gateVerdict} |`,
    );
  }

  lines.push("", "## Detail", "");

  for (const [stage, stageRuns] of byStage) {
    const latest = stageRuns[0]!;
    lines.push(`### ${stage}`, "");
    lines.push(`Run: ${latest.runId}`);
    lines.push(`Git: ${latest.gitSha}`);
    lines.push(`Config: ${latest.configHash}`);
    lines.push(`Key: ${latest.answerKey} | Split: ${latest.split}`);
    lines.push(`n: ${latest.n}`);
    lines.push("");
    lines.push("**Metrics:**");
    lines.push("```");
    lines.push(formatMetrics(latest.metrics));
    lines.push("```");
    lines.push("");
    lines.push("**95% CIs:**");
    lines.push("```");
    lines.push(formatCI(latest.ci));
    lines.push("```");
    lines.push("");
  }

  const md = lines.join("\n");

  if (opts.outDir) {
    mkdirSync(opts.outDir, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    const path = join(opts.outDir, `${date}.md`);
    writeFileSync(path, md);
  }

  return md;
}
