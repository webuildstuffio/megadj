// FixesTab.tsx — the shelf drive's Fixes tab. Two-thirds UX law: a
// plain-language VERDICT banner first, then the fix-first work queue
// (worst first, each row carries its `megadj` fix command with a copy
// button), then raw detail. The tab is a remote control: scan/apply
// enqueue jobs over /api/fixes — megadj's booth-fix CLI stays the single
// implementation (the fleet selected on Fleet → Booth drives every check).
import { useCallback, useEffect, useState } from "preact/hooks";
import type { FixRow, FixesPayload } from "../../../../cratedeck/shared/fixes";
import { errMessage } from "../../../shared/fmt";
import { api, apiPost, toast } from "../../ui/toast";
import { Icon } from "../../ui/icons";
import { InfoTip } from "../../ui/InfoTip";
import { Verdict } from "../shared";
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
  const [payload, setPayload] = useState<FixesPayload | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPayload(await api<FixesPayload>("/api/fixes", { quiet: true }));
      setLoadErr(null);
    } catch (e) {
      const m = errMessage(e);
      console.error("fixes load failed", e);
      setLoadErr(m);
    }
  }, []);

  useEffect(() => {
    load().catch((e: unknown) => console.error("fixes initial load failed", e));
    const onJob = () => {
      load().catch((e: unknown) =>
        console.error("fixes job-event reload failed", e),
      );
    };
    window.addEventListener("cratedeck:job", onJob);
    return () => window.removeEventListener("cratedeck:job", onJob);
  }, [load]);

  const enqueue = async (kind: "scan" | "apply") => {
    setBusy(kind);
    try {
      await apiPost(`/api/fixes/${kind}`, {});
      toast(
        kind === "scan"
          ? "Booth audit queued"
          : "Apply queued — safe fixes only, nothing deletes",
        "ok",
      );
    } catch {
      /* toast already surfaced the failure */
    } finally {
      setBusy(null);
    }
  };

  if (loadErr && !payload) {
    return (
      <div class="note bad">
        <Icon name="warn" size={14} /> Fixes audit unavailable: {loadErr}
      </div>
    );
  }
  if (!payload) {
    return (
      <div class="note">
        <Icon name="clock" size={14} /> Loading the fixes plan…
      </div>
    );
  }

  const fixRows = payload.rows
    .filter((r) => r.action !== "none")
    .sort((a, b) => rank(a) - rank(b));
  const manualRows = payload.rows
    .filter((r) => r.action === "none")
    .sort((a, b) => rank(a) - rank(b));
  const boothTerm = HELP_TERMS.find((t) => t.term === "Booth fleet");

  const banner = !payload.scannedPath
    ? {
        cls: "ok" as const,
        text: "No booth audit yet — run a scan to check the shelf against your player fleet.",
      }
    : payload.fixable === 0
      ? {
          cls: "ok" as const,
          text: `All clear — ${payload.checked.toLocaleString()} files checked, nothing needs fixing.`,
        }
      : {
          cls: "warn" as const,
          text: `${payload.fixable} file${payload.fixable === 1 ? "" : "s"} need${payload.fixable === 1 ? "s" : ""} fixing (of ${payload.checked.toLocaleString()} checked) — ${manualRows.length} more need your call.`,
        };

  return (
    <>
      <Verdict cls={banner.cls} text={banner.text} />

      <div class="actions" style={{ marginTop: 10 }}>
        <button
          type="button"
          class="btn"
          disabled={busy !== null}
          onClick={() => enqueue("scan")}
          title="Dry-run megadj booth-fix over the shelf Contents (job)"
        >
          <Icon name="scan" size={14} />
          {busy === "scan" ? "Scanning…" : "Scan shelf"}
        </button>
        <button
          type="button"
          class="btn primary"
          disabled={busy !== null || fixRows.length === 0}
          onClick={() => enqueue("apply")}
          title="Apply the SAFE subset: renames + tag rewrites. After this, relink in rekordbox (Collection → ⌘A → Relocate Lost Files)."
        >
          <Icon name="check" size={14} />
          {busy === "apply"
            ? "Applying…"
            : `Apply ${fixRows.length} safe fix${fixRows.length === 1 ? "" : "es"}`}
        </button>
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
                    MEGADJ_MUSIC_DIR={payload.scannedPath ?? "<shelf>"} megadj
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
    </>
  );
}
