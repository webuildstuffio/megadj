// FixesTab.tsx — the shelf drive's Fixes tab. Two-thirds UX law: a
// plain-language VERDICT banner first, then the fix-first work queue
// (worst first, each row carries its `megadj` fix command with a copy
// button), then raw detail. The tab is a remote control: scan/apply
// enqueue jobs over /api/fixes — megadj's booth-fix CLI stays the single
// implementation (the fleet selected on Fleet → Booth drives every check).
import type { FixRow, FixesPayload } from "../../../../cratedeck/shared/fixes";
import { Icon } from "../../ui/icons";
import { InfoTip } from "../../ui/InfoTip";
import {
  Verdict,
  useScanApply,
  ScanApplyGate,
  ScanApplyActions,
} from "../shared";
import { HELP_TERMS } from "../../../shared/help";

/** Work-queue order: rows WITH a safe autofix first (rename, then tag
 *  rewrite), then proposals that need a human (action "none"). */
function rank(r: FixRow): number {
  if (r.action === "rename") return 0;
  if (r.action === "sanitize-tags") return 1;
  return 2;
}

const REASON_LABEL: Record<string, string> = {
  "path-trailing-dot-or-space": "Trailing dot/space in filename",
  "path-illegal-character": "Illegal character in filename",
  "non-fleet-characters": "Characters the players can't display",
  mojibake: "Garbled text (double-encoded)",
  "float-pcm-unsupported": "Float WAV — players reject it",
  "sample-rate-unsupported": "Sample rate above the fleet floor",
  "bit-depth-unsupported": "Bit depth above the fleet floor",
  "codec-unsupported": "Codec not playable on this fleet",
  "path-too-deep": "Folder path too deep for the players",
};

const ACTION_TONE: Record<string, string> = {
  rename: "rename",
  "sanitize-tags": "tags",
};

function reasonLabel(reasons: FixRow["reasons"]): string {
  const first = reasons[0];
  if (first === undefined) return "Flagged";
  return REASON_LABEL[first] ?? first;
}

function actionLabel(action: FixRow["action"]): string {
  return ACTION_TONE[action] ?? action;
}

export function FixesTab(_props: { driveId: string; driveName: string }) {
  const { payload, loadErr, busy, enqueue } = useScanApply<FixesPayload | null>(
    {
      readPath: "/api/fixes",
      actionPath: "/api/fixes",
      label: {
        thing: "fixes",
        scanDone: "Booth audit queued",
        applyDone: "Apply queued — safe fixes only, nothing deletes",
      },
    },
  );

  // payload may be null (fetched, never scanned) — the banner below owns
  // that state; narrow the row views to the scanned case up front.
  // The Gate handles undefined (in flight) / loadErr; everything below the
  // Gate's guard is the scanned-or-never case, so `!` on scannedPath is safe.
  const scanned = payload as FixesPayload | null | undefined;
  const fixRows =
    scanned?.rows
      .filter((r) => r.action !== "none")
      .toSorted((a, b) => rank(a) - rank(b)) ?? [];
  const manualRows =
    scanned?.rows
      .filter((r) => r.action === "none")
      .toSorted((a, b) => rank(a) - rank(b)) ?? [];
  const boothTerm = HELP_TERMS.find((t) => t.term === "Booth fleet");

  const banner =
    scanned == null || !scanned.scannedPath
      ? {
          cls: "ok" as const,
          text: "No booth audit yet — run a scan to check the shelf against your player fleet.",
        }
      : scanned.fixable === 0
        ? {
            cls: "ok" as const,
            text: `All clear — ${scanned.checked.toLocaleString()} files checked, nothing needs fixing.`,
          }
        : {
            cls: "warn" as const,
            text: `${scanned.fixable} file${scanned.fixable === 1 ? "" : "s"} need${scanned.fixable === 1 ? "s" : ""} fixing (of ${scanned.checked.toLocaleString()} checked) — ${manualRows.length} more need your call.`,
          };

  return (
    <ScanApplyGate
      loadErr={loadErr}
      payload={payload}
      unavailable={`Fixes audit unavailable: ${loadErr ?? ""}`}
      loading="Loading the fixes plan…"
    >
      <Verdict cls={banner.cls} text={banner.text} />

      <div class="actions" style={{ marginTop: 10 }}>
        <ScanApplyActions
          busy={busy}
          applyDisabled={fixRows.length === 0}
          scanTitle="Dry-run megadj booth-fix over the shelf Contents (job)"
          applyTitle="Apply the SAFE subset: renames + tag rewrites. After this, relink in rekordbox (Collection → ⌘A → Relocate Lost Files)."
          applyLabel={() =>
            `Apply ${fixRows.length} safe fix${fixRows.length === 1 ? "" : "es"}`
          }
          onScan={() => enqueue("scan")}
          onApply={() => enqueue("apply")}
        />
        <InfoTip
          title="Booth fleet"
          body={
            boothTerm?.def ??
            "Every check enforces the player fleet selected on Fleet → Booth."
          }
          why={
            boothTerm?.why ??
            "The floor is the intersection of your players — a file passes only if every booth can play and display it."
          }
        />
      </div>

      <p class="note">
        After applying renames on the shelf, open rekordbox → Collection → ⌘A →
        right-click <b>Relocate Lost Files</b> (one pass), then re-sync any
        stick. See <code>.claude/skills/booth-check/SKILL.md</code>.
      </p>

      {fixRows.length > 0 && (
        <>
          <h3 class="sect">
            <Icon name="warn" /> Work queue — worst first
          </h3>
          <div class="checks">
            {fixRows.map((r) => (
              <div class="check" key={r.file + r.reasons.join()}>
                <span class="pill">{actionLabel(r.action)}</span>
                <span class="check-body">
                  <b>{reasonLabel(r.reasons)}</b>
                  <span class="check-detail" title={r.file}>
                    {r.file}
                    {r.plan ? ` — ${r.plan}` : ""}
                  </span>
                  <code class="hyg-cmd">
                    MEGADJ_MUSIC_DIR={payload?.scannedPath ?? "<shelf>"} megadj
                    booth-fix --apply --yes
                  </code>
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {manualRows.length > 0 && (
        <>
          <h3 class="sect">
            <Icon name="warn" /> Needs your call — no safe auto-fix
          </h3>
          <div class="checks">
            {manualRows.map((r) => (
              <div class="check muted" key={r.file + r.reasons.join()}>
                <span class="pill warn">manual</span>
                <span class="check-body">
                  <b>{reasonLabel(r.reasons)}</b>
                  <span class="check-detail" title={r.file}>
                    {r.file}
                  </span>
                  <code class="hyg-cmd">megadj convert --dry-run</code>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </ScanApplyGate>
  );
}
