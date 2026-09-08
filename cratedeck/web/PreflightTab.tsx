// PreflightTab.tsx — B12 gig-night gate, the UI half of surface-parity G1.
//
// Preflight + player compat were CLI/MCP-only at audit time; the doc
// recorded them as the "B12 remainder". This closes it: one tab on the
// Fleet page rendering the same GET /api/preflight payload deckctl/
// deck_preflight consume — verdict cards per drive, expandable checks,
// firmware advisories, N78 player-compat folded in per drive.

import { useEffect, useState } from "preact/hooks";
import { api } from "./toast";
import { Icon } from "./icons";
import type {
  CheckStatus,
  HealthCheck,
  PreflightVerdict,
} from "../shared/types";

/** Wire subset of PreflightReport (GET /api/preflight); player compat
 *  (N78) is fetched lazily per expanded drive card from /api/drives/:id/players. */
interface PreflightPayload {
  generated_at: number;
  overall: PreflightVerdict;
  summary: string;
  mountedCount: number;
  firmware_advisories: string[];
  drives: {
    drive: {
      id: string;
      name: string;
      nickname: string | null;
      mounted: boolean;
    };
    overall: PreflightVerdict;
    checks: HealthCheck[];
    blockers: string[];
  }[];
}

interface PlayersPayload {
  drive: { id: string; name: string; nickname: string | null };
  measured: { pdb_live_rows: number | null; onelibrary_rows: number | null };
  ok: { name: string }[];
  blocked: { player: { name: string }; reason: string }[];
  unknown: boolean;
}

const VERDICT_ICON: Record<string, string> = {
  ready: "check",
  attention: "warn",
  "not-ready": "x",
  unknown: "dot",
};

const VERDICT_TONE: Record<string, string> = {
  ready: "ok",
  attention: "warn",
  "not-ready": "bad",
  unknown: "",
};

const STATUS_ICON: Record<CheckStatus, string> = {
  pass: "check",
  warn: "warn",
  fail: "x",
  unknown: "dot",
};

export function PreflightTab() {
  const [data, setData] = useState<PreflightPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [players, setPlayers] = useState<Record<string, PlayersPayload>>({});

  useEffect(() => {
    api<PreflightPayload>("/api/preflight")
      .then(setData)
      .catch((e: unknown) =>
        setErr(e instanceof Error ? e.message : String(e)),
      );
  }, []);

  const toggle = (id: string) => {
    setOpen(open === id ? null : id);
    if (!players[id]) {
      api<PlayersPayload>(`/api/drives/${encodeURIComponent(id)}/players`)
        .then((p) => setPlayers((prev) => ({ ...prev, [id]: p })))
        .catch(() =>
          setPlayers((prev) => ({
            ...prev,
            [id]: {
              drive: { id, name: "", nickname: null },
              measured: { pdb_live_rows: null, onelibrary_rows: null },
              ok: [],
              blocked: [],
              unknown: true,
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
        <Icon
          name={VERDICT_ICON[data.overall] ?? "dot"}
          size={16}
        />{" "}
        <strong>{data.overall}</strong> — {data.summary} ({data.mountedCount}{" "}
        mounted)
      </div>

      {data.firmware_advisories.length > 0 && (
        <div class="note">
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
          >
            <span class={`rolechip ${VERDICT_TONE[d.overall] ?? ""}`}>
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
            <span class="pf-chevron">
              <Icon name="sort" size={12} />
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
              {d.checks.map((c) => (
                <div key={c.id} class={`check ${VERDICT_TONE[c.status] ?? ""}`}>
                  <Icon name={STATUS_ICON[c.status]} size={12} />
                  <strong>{c.label}</strong>
                  <span class="detail">{c.detail}</span>
                  {c.status !== "pass" && c.fix && (
                    <span class="fix">fix: {c.fix}</span>
                  )}
                </div>
              ))}
              {(players[d.drive.id]?.blocked ?? []).map((p) => (
                <div key={p.player.name} class="check bad">
                  <Icon name="x" size={12} />
                  <strong>{p.player.name}</strong>
                  <span class="detail">can't read this drive — {p.reason}</span>
                </div>
              ))}
              {(players[d.drive.id]?.ok ?? []).map((p) => (
                <div key={p.name} class="check">
                  <Icon name="disc" size={12} />
                  <strong>{p.name}</strong>
                  <span class="detail">reads this drive</span>
                </div>
              ))}
              {players[d.drive.id] && players[d.drive.id]?.unknown && (
                <div class="check">
                  <Icon name="dot" size={12} />
                  <strong>Player compat</strong>
                  <span class="detail">
                    unknown — run a full scan to measure dual-DB rows
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
