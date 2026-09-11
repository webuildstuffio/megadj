// deckctl_report.ts — `deckctl report` (health dossier) + its --dossier
// mode (surface-parity GAP-6), extracted from deckctl.ts at the
// file-length guard. The plain report prints check rows; --dossier
// streams the exact GET /drives/:id/export bundle the UI's Export button
// serves (--out FILE writes it to disk instead).

import { apiGet, resolveDrive } from "./deckapi";
import type { DriveReport } from "../shared/types";

export interface ReportPrintHooks {
  jsonMode: boolean;
  log: (s: string) => void;
  errOut: (s: string) => void;
  exit: (code: number) => never;
}

/** `deckctl report <drive> [--dossier] [--out FILE]` */
export async function cmdReport(
  h: ReportPrintHooks,
  nameOrId: string,
  argv: string[],
): Promise<void> {
  const d = await resolveDrive(nameOrId);
  if (!d) {
    h.errOut(`unknown drive: ${nameOrId}`);
    h.exit(2);
  }
  // --dossier: the full export bundle — the parity twin of the UI's
  // Export button (same GET /drives/:id/export payload).
  if (argv.includes("--dossier")) {
    const outIdx = argv.indexOf("--out");
    const outFile = outIdx >= 0 ? argv[outIdx + 1] : undefined;
    const res = await apiGet(`/api/drives/${d.id}/export`);
    const text = await res.text();
    if (outFile) {
      await Bun.write(outFile, `${text}\n`);
      if (h.jsonMode)
        console.log(
          JSON.stringify({
            command: "report",
            dossier: true,
            written: outFile,
          }),
        );
      else h.log(`dossier written: ${outFile}`);
      return;
    }
    console.log(text); // the dossier IS json — print it raw
    return;
  }
  const r = (await apiGet(`/api/drives/${d.id}/report`).then((x) =>
    x.json(),
  )) as DriveReport & { overall?: string };
  if (h.jsonMode) {
    console.log(JSON.stringify(r, null, 2));
    return;
  }
  const checks = r.checks ?? [];
  const icon: Record<string, string> = {
    pass: "✓",
    warn: "▲",
    fail: "✕",
    unknown: "○",
  };
  h.log(`drive: ${d.nickname ?? d.name}  overall: ${r.overall ?? "?"}`);
  h.log("");
  for (const c of checks) {
    h.log(`${icon[c.status]} ${c.label}: ${c.detail}`);
    if (c.fix) h.log(`   → ${c.fix}`);
  }
}
