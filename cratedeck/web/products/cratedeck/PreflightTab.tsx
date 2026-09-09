// PreflightTab.tsx — B12 gig-night gate, the UI half of surface-parity G1.
//
// Preflight + player compat were CLI/MCP-only at audit time; the doc
// recorded them as the "B12 remainder". This closes it: one tab on the
// Fleet page rendering the same GET /api/preflight payload deckctl/
// deck_preflight consume — verdict cards per drive, expandable checks,
// firmware advisories, N78 player-compat folded in per drive.

import { useState } from "preact/hooks";
import { api } from "../../ui/toast";
import { Icon } from "../../ui/icons";
import { errMessage } from "../../../shared/fmt";
import { useFetched } from "../../ui/useFetched";
import type {
  CheckStatus,
  PlayersPayload,
  PreflightReport,
} from "../../../shared/types";
import { InfoTip } from "../../ui/InfoTip";
// PlayersPayload = the wire shape of GET /api/drives/:id/players (N78),
// imported from the shared SSOT instead of re-declared here — a local
// duplicate drifts silently (the Sep 7 ArchiveTab bug class).

/** Per-drive player-compat load state: payload, or the failure that
 *  replaces it. A failed fetch must never render as "unknown — run a scan";
 *  that verdict is a measurement gap, not a transport error. */
type PlayersState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; payload: PlayersPayload };

const VERDICT_ICON: Record<string, string> = {
  ready: "check",
  attention: "warn",
  "not-ready": "x",
  unknown: "dot",
};

const VERDICT_TONE: Record<string, string> = {
  ready: "pass",
  attention: "warn",
  "not-ready": "fail",
  unknown: "unknown",
};

const STATUS_ICON: Record<CheckStatus, string> = {
  pass: "check",
  warn: "warn",
  fail: "x",
  unknown: "dot",
};

/** Hover copy for each preflight verdict — the promise each word makes. */
const VERDICT_HELP: Record<string, { body: string; why: string }> = {
  ready: {
    body: "Every mounted drive measured ready. This is the walk-out-the-door green.",
    why: "'Ready' requires data — all-unknown drives never fake it.",
  },
  attention: {
    body: "Nothing is broken, but at least one drive has a warning (stale verify, low space, thin beatgrids). Playable — know what you're carrying.",
    why: "Click the drive below to see exactly which check warned.",
  },
  "not-ready": {
    body: "At least one mounted drive has a FAILING check — do not take it as your only stick.",
    why: "The blockers line under the drive names the exact failure and fix.",
  },
  unknown: {
    body: "Some mounted drives have no data yet (never scanned). Unknown is not ready — scan first, then re-run.",
    why: "Preflight is a gate for cron/agents: exit code 1 on anything but ready.",
  },
};

/** Hover copy per preflight check id (mirrors src/preflight.ts checks). */
const PF_CHECK_HELP: Record<string, { what: string; why: string }> = {
  "dual-db": {
    what: "Are the drive's two rekordbox libraries in agreement?",
    why: "Stale pdb = the booth sees an old library even though your laptop shows the new one.",
  },
  grids: {
    what: "Beatgrid/ANLZ coverage — how many tracks have waveform data at the path hardware reads.",
    why: "Missing grids = no Beat Sync and no waveforms on those tracks.",
  },
  verify: {
    what: "Age and result of the last deep integrity audit.",
    why: "Library changes after verify are unproven — re-verify after adding music.",
  },
  speed: {
    what: "Latest read-speed benchmark vs the ~30 MB/s CDJ floor and the previous run.",
    why: "A big drop between runs predicts a dying stick better than one absolute number.",
  },
  bitrot: {
    what: "Checksum ledger comparison — any file whose bytes changed since it was hashed.",
    why: "Silent corruption has no other symptom until the track fails mid-set.",
  },
  space: {
    what: "Free space — rekordbox needs headroom for its DB journal.",
    why: "A full drive corrupts exports; under ~15% free already degrades syncs.",
  },
  mirror: {
    what: "Mirror file count vs the master's.",
    why: "A behind mirror isn't a backup for the tracks it lacks.",
  },
  players: {
    what: "Which known players can read this drive, from measured dual-DB rows.",
    why: "A partial block is the 'works at home, invisible in the booth' trap — check the venue units.",
  },
};

export function PreflightTab() {
  const page = useFetched<PreflightReport>(() => api("/api/preflight"), []);
  const data = page.status === "ok" ? page.data : null;
  const err = page.status === "error" ? page.message : null;
  const [open, setOpen] = useState<string | null>(null);
  const [players, setPlayers] = useState<Record<string, PlayersState>>({});

  const toggle = (id: string) => {
    setOpen(open === id ? null : id);
    if (!players[id]) {
      setPlayers((prev) => ({ ...prev, [id]: { status: "loading" } }));
      api<PlayersPayload>(`/api/drives/${encodeURIComponent(id)}/players`, {
        quiet: true,
      })
        .then((p) =>
          setPlayers((prev) => ({
            ...prev,
            [id]: { status: "ok", payload: p },
          })),
        )
        .catch((e: unknown) =>
          setPlayers((prev) => ({
            ...prev,
            [id]: {
              status: "error",
              message: errMessage(e),
            },
          })),
        );
    }
  };

  if (err)
    return (
      <div class="note bad">
        <Icon name="warn" size={14} /> {err}
      </div>
    );
  if (!data)
    return (
      <div class="note">
        <Icon name="refresh" size={14} /> Checking every drive…
      </div>
    );

  return (
    <div class="preflight">
      <div class={`note ${VERDICT_TONE[data.overall] ?? ""}`}>
        <Icon name={VERDICT_ICON[data.overall] ?? "dot"} size={16} />{" "}
        <strong>{data.overall}</strong> — {data.summary} ({data.mountedCount}{" "}
        mounted)
        <InfoTip
          title={`preflight verdict: ${data.overall}`}
          body={
            VERDICT_HELP[data.overall]?.body ??
            "Worst status across mounted drives wins."
          }
          why={
            VERDICT_HELP[data.overall]?.why ??
            "deckctl preflight exits 1 unless the verdict is ready."
          }
        />
      </div>

      {data.firmware_advisories.length > 0 && (
        <div
          class="note"
          title="Known vendor firmware problems (e.g. a pulled CDJ-3000 update that made playlists vanish). Informational — not a drive fault."
        >
          <Icon name="bell" size={14} /> Firmware advisories:{" "}
          {data.firmware_advisories.join(" · ")}
        </div>
      )}

      {data.drives.map((d) => (
        <div key={d.drive.id} class="card pf-drive">
          <button
            type="button"
            class="pf-head"
            onClick={() => toggle(d.drive.id)}
            title={
              open === d.drive.id
                ? "Collapse this drive's checks"
                : "Expand checks, blockers and player compatibility"
            }
          >
            <span class={`rolechip ${VERDICT_TONE[d.overall] ?? "unknown"}`}>
              <Icon name={VERDICT_ICON[d.overall] ?? "dot"} size={12} />
              {d.overall}
            </span>
            <strong>
              {d.drive.nickname ?? d.drive.name}
              {!d.drive.mounted && " (unmounted)"}
            </strong>
            {d.blockers.length > 0 && (
              <span class="pf-blockers">
                {d.blockers.length} blocker{d.blockers.length === 1 ? "" : "s"}
              </span>
            )}
            <span class={`pf-chevron ${open === d.drive.id ? "open" : ""}`}>
              <Icon name={open === d.drive.id ? "chevU" : "chevD"} size={12} />
            </span>
          </button>

          {open === d.drive.id && (
            <div class="pf-body">
              {d.blockers.length > 0 && (
                <div class="note bad">
                  {d.blockers.map((b) => (
                    <div key={b}>
                      <Icon name="x" size={12} /> {b}
                    </div>
                  ))}
                </div>
              )}
              {d.checks.map((c) => {
                const pf = PF_CHECK_HELP[c.id];
                return (
                  <div
                    key={c.id}
                    class={`check ${c.status}`}
                    title={pf ? `${pf.what} ${pf.why}` : undefined}
                  >
                    <Icon name={STATUS_ICON[c.status]} size={12} />
                    <strong>{c.label}</strong>
                    {pf && (
                      <InfoTip
                        title={c.label}
                        body={pf.what}
                        why={pf.why}
                        align="right"
                      />
                    )}
                    <span class="detail">{c.detail}</span>
                    {c.status !== "pass" && c.fix && (
                      <span class="fix">fix: {c.fix}</span>
                    )}
                  </div>
                );
              })}
              {(() => {
                const ps = players[d.drive.id];
                if (ps?.status === "error")
                  return (
                    <div class="check warn">
                      <Icon name="warn" size={12} />
                      <strong>Player compat</strong>
                      <span class="detail">
                        unavailable: {ps.message} — close and reopen this card
                        to retry
                      </span>
                    </div>
                  );
                if (ps?.status !== "ok") return null;
                const p = ps.payload;
                return (
                  <>
                    {p.blocked.map((b) => (
                      <div key={b.player.name} class="check fail">
                        <Icon name="x" size={12} />
                        <strong>{b.player.name}</strong>
                        <span class="detail">
                          can't read this drive — {b.reason}
                        </span>
                      </div>
                    ))}
                    {p.ok.map((p2) => (
                      <div key={p2.name} class="check">
                        <Icon name="disc" size={12} />
                        <strong>{p2.name}</strong>
                        <span class="detail">reads this drive</span>
                      </div>
                    ))}
                    {p.unknown && (
                      <div class="check">
                        <Icon name="dot" size={12} />
                        <strong>Player compat</strong>
                        <span class="detail">
                          unknown — run a full scan to measure dual-DB rows
                        </span>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
