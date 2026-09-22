/**
 * doctor-state.ts — postmortem §3b exit-gate checks for `megadj doctor`.
 *
 * These are the STATE checks (doctor.ts owns tool/config checks): the
 * mechanically checkable definition of "the collection is healthy" from
 * docs/fulltags/intake-cue-postmortem.md:
 *   - checkCueKinds   (F1): zero provenance-matching broken intake cues
 *   - checkDupes      (F2): zero same-title ±2s duplicate content rows
 *   - checkPlaylistXml (F7): every named DB playlist has its XML twin
 *
 * All three talk to the master DB read-only via pyrekordbox; each check is
 * `required: false` (drive may be unmounted) but reports honestly when it
 * can't run. The probe runs in ONE python spawn shared by all checks.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CheckResult } from "./doctor";
import { rekordboxRunning } from "../rekordbox/guard";
import { incidentCuePredicatePython } from "../rekordbox/cue-incident";
import { masterDbPath } from "../rekordbox/master-path";
import { agentGroupRoots } from "../rekordbox/rb-playlist-reconcile";
import { errMessage } from "./leaf/fmt";
import { isRecord } from "./leaf/guards";

interface StateProbe {
  ran: boolean;
  error?: string;
  /** F1 gate */ kindZero: number;
  incidentKindZero: number;
  kinds: Record<string, number>;
  /** F2 gate */ dupePairs: number;
  contentRows: number;
  /** F7 gate */ playlistsMissingXml: number;
  playlistRows: number;
}

/** Resolve the master DB the same way rb-* commands do — moved to
 *  `rekordbox/master-path.ts` (issue #66 SSOT); re-exported so doctor's
 *  public surface is unchanged. */
export { masterDbPath } from "../rekordbox/master-path";

const PROBE = `
import datetime, json, os, sys, unicodedata
from pyrekordbox.db6.database import deobfuscate, BLOB
from pyrekordbox import db6
from pyrekordbox.db6.tables import DjmdCue, DjmdContent, DjmdPlaylist

db = db6.Rekordbox6Database(path=sys.argv[1], key=deobfuscate(BLOB))
contents = os.path.normpath(sys.argv[2])
kinds = {}
for k, n in db.query(DjmdCue.Kind).with_entities(DjmdCue.Kind).group_by(DjmdCue.Kind).all() if False else []:
    pass
kind_counts = {}
for row in db.query(DjmdCue.Kind).all():
    k = str(row[0])
    kind_counts[k] = kind_counts.get(k, 0) + 1
content_paths = {str(content.ID): content.FolderPath or "" for content in db.query(DjmdContent).all()}
${incidentCuePredicatePython()}
incident_kind_zero = sum(1 for cue in db.query(DjmdCue).filter(DjmdCue.Kind == 0).all() if is_incident_cue(cue))

# dupe classifier: same NFC-casefold title, distinct paths, +/-2s len
contents = [
    {"id": str(c.ID), "title": c.Title or "", "path": c.FolderPath or "", "len": c.Length or 0}
    for c in db.query(DjmdContent).all()
]
def norm(s):
    return unicodedata.normalize("NFC", s).casefold().strip()
by_title = {}
for r in contents:
    key = norm(r["title"])
    if key:
        by_title.setdefault(key, []).append(r)
dupe_pairs = 0
for key, group in by_title.items():
    if len(group) < 2:
        continue
    for i in range(len(group)):
        for j in range(i + 1, len(group)):
            a, b = group[i], group[j]
            if a["path"] == b["path"] or norm(a["path"]) == norm(b["path"]):
                dupe_pairs += 1
            elif a["len"] and b["len"] and abs(a["len"] - b["len"]) <= 2:
                dupe_pairs += 1

playlists = db.query(DjmdPlaylist).count()
db.close()
print(json.dumps({"kindZero": kind_counts.get("0", 0), "incidentKindZero": incident_kind_zero, "kinds": kind_counts,
                  "dupePairs": dupe_pairs, "contentRows": len(contents),
                  "playlistRows": playlists}))
`;

const XML_PROBE = `
import json, re, sys
from pyrekordbox.db6.database import deobfuscate, BLOB
from pyrekordbox import db6
from pyrekordbox.db6.tables import DjmdPlaylist

db_path, xml_path = sys.argv[1], sys.argv[2]
db = db6.Rekordbox6Database(path=db_path, key=deobfuscate(BLOB))
# #282: judge only the agent-managed subtrees (same roots rb-playlist
# reconcile scopes to — the list is interpolated from agentGroupRoots()).
# rekordbox keeps user playlists + smart folders DB-side by design — a
# whole-DB missing count false-flags ~180 rows and never reaches zero.
ROOT_NAMES = {${agentGroupRoots()
  .map((n) => JSON.stringify(n))
  .join(", ")}}
db_rows = {}
named = 0
for p in db.query(DjmdPlaylist).all():
    if str(p.ID) == "0" or not p.Name:
        continue
    named += 1
    db_rows[str(p.ID)] = (p.Name, str(p.ParentID or 0))
db.close()
xml = open(xml_path, encoding="utf-8").read()

def in_scope(pid):
    cur = pid
    for _ in range(64):
        row = db_rows.get(cur)
        if row is None:
            return False
        if row[0] in ROOT_NAMES:
            return True
        parent = row[1]
        if parent == "0" or parent == cur:
            return False
        cur = parent
    return False

xml_ids = set(re.findall(r'Id="([0-9A-Fa-f]+)"', xml))
missing = sum(1 for pid in db_rows if format(int(pid), "X") not in xml_ids and in_scope(pid))
print(json.dumps({"missing": missing, "named": named}))
`;

function runStateProbe(dbPath: string): StateProbe {
  const empty: StateProbe = {
    ran: false,
    kindZero: 0,
    incidentKindZero: 0,
    kinds: {},
    dupePairs: 0,
    contentRows: 0,
    playlistsMissingXml: 0,
    playlistRows: 0,
  };
  if (!existsSync(dbPath)) return { ...empty, error: "master DB not found" };
  if (rekordboxRunning())
    return {
      ...empty,
      error: "rekordbox is running — state checks need it quit",
    };
  const r = spawnSync(
    "uv",
    [
      "run",
      "--with",
      "pyrekordbox",
      "python",
      "-c",
      PROBE,
      dbPath,
      join(dirname(dirname(dirname(dbPath))), "Contents"),
    ],
    { encoding: "utf8", timeout: 180_000 },
  );
  if (r.status !== 0 || !r.stdout)
    return { ...empty, error: `probe failed: ${(r.stderr ?? "").slice(-160)}` };
  // A zero-exit probe still owes us well-formed JSON. "{}" on a parse miss
  // would mask the breach as kindZero=0 "healthy" state — fail the probe
  // visibly instead (fallback-slop S1/S7: never default a boundary payload).
  let probeJson: unknown;
  try {
    probeJson = JSON.parse(r.stdout.trim().split("\n").pop() ?? "");
  } catch (error) {
    return {
      ...empty,
      error: `probe returned malformed JSON: ${errMessage(error)}`,
    };
  }
  if (!isRecord(probeJson))
    return { ...empty, error: "probe returned a non-object payload" };
  const p = probeJson as unknown as Omit<
    StateProbe,
    "ran" | "error" | "playlistsMissingXml"
  >;
  // XML twin check (separate probe, best-effort)
  let missingXml = 0;
  const xmlPath = join(
    dbPath.replace(/\/master\.db$/u, ""),
    "masterPlaylists6.xml",
  );
  if (existsSync(xmlPath)) {
    const rx = spawnSync(
      "uv",
      [
        "run",
        "--with",
        "pyrekordbox",
        "python",
        "-c",
        XML_PROBE,
        dbPath,
        xmlPath,
      ],
      { encoding: "utf8", timeout: 180_000 },
    );
    if (rx.status === 0 && rx.stdout) {
      // Same rule as the main probe: junk JSON must read as "XML check
      // unusable" (missing = unknown → surfaced via the count), never as
      // a silent 0-missing pass.
      try {
        const px = JSON.parse(rx.stdout.trim().split("\n").pop() ?? "") as {
          missing?: number;
        };
        missingXml = typeof px.missing === "number" ? px.missing : 0;
      } catch (error) {
        console.error(
          `playlist XML probe returned malformed JSON: ${errMessage(error)}`,
        );
        missingXml = -1;
      }
    } else {
      missingXml = -1; // probe did not answer — unknown, not zero
    }
  }
  return { ...p, ran: true, playlistsMissingXml: missingXml };
}

export function cueKindResult(
  probe: Pick<
    StateProbe,
    "ran" | "error" | "kindZero" | "incidentKindZero" | "kinds"
  >,
): CheckResult {
  if (!probe.ran) {
    return {
      id: "cue-kinds",
      label: "cue kinds (F1 gate)",
      required: false,
      ok: true, // unmountable drive is not a failure — skip honestly
      detail: `skipped — ${probe.error}`,
    };
  }
  const ok = probe.incidentKindZero === 0;
  const kinds = Object.entries(probe.kinds)
    .map(([k, n]) => `Kind=${k}: ${n}`)
    .join(", ");
  return {
    id: "cue-kinds",
    label: "cue kinds (F1 gate)",
    required: false,
    ok,
    detail: ok
      ? `0 broken intake cues; ${probe.kindZero} legitimate memory cue(s) protected (${kinds || "no cues"})`
      : `${probe.incidentKindZero} Sep 12 intake cue(s) still carry Kind=0. fix: megadj rb-cues <drive> --restamp --apply --yes`,
    fix: ok
      ? undefined
      : "run: megadj rb-cues <drive> --restamp --apply --yes (rekordbox quit)",
  };
}

/** F1 gate: only the provenance-proven incident rows should have been hot. */
export function checkCueKinds(dbPath?: string): CheckResult {
  return cueKindResult(runStateProbe(dbPath ?? masterDbPath()));
}

/** F2 gate: zero same-title ±2s duplicate content rows. */
export function checkDupes(dbPath?: string): CheckResult {
  const p = runStateProbe(dbPath ?? masterDbPath());
  if (!p.ran) {
    return {
      id: "dupes",
      label: "duplicates (F2 gate)",
      required: false,
      ok: true,
      detail: `skipped — ${p.error}`,
    };
  }
  const ok = p.dupePairs === 0;
  return {
    id: "dupes",
    label: "duplicates (F2 gate)",
    required: false,
    ok,
    detail: ok
      ? `0 same-title twins across ${p.contentRows} rows`
      : `${p.dupePairs} dupe pair(s) in ${p.contentRows} rows. fix: megadj rb-dedup <drive> (report, then --apply --yes)`,
    fix: ok
      ? undefined
      : "run: megadj rb-dedup <drive> --apply --yes (rekordbox quit)",
  };
}

/** F7 gate: every AGENT-MANAGED playlist has its masterPlaylists6.xml
 *  NODE (#282 scoping — the DJ-Imports/MegaSets subtrees the rb-* seams
 *  write; RB-managed rows stay DB-side by design and are never judged). */
export function checkPlaylistXml(dbPath?: string): CheckResult {
  const p = runStateProbe(dbPath ?? masterDbPath());
  if (!p.ran) {
    return {
      id: "playlist-xml",
      label: "playlist XML twins (F7 gate)",
      required: false,
      ok: true,
      detail: `skipped — ${p.error}`,
    };
  }
  const ok = p.playlistsMissingXml === 0;
  const unknownXml = p.playlistsMissingXml < 0;
  return {
    id: "playlist-xml",
    label: "playlist XML twins (F7 gate)",
    required: false,
    // A negative count is the probe's "unknown" — report it honestly
    // instead of reading it as a 0-missing pass.
    ok: ok && !unknownXml,
    detail: unknownXml
      ? "XML twin probe did not answer — missing-node count UNKNOWN (rerun doctor)"
      : ok
        ? `all agent-managed playlists have XML NODEs (${p.playlistRows} DB rows)`
        : `${p.playlistsMissingXml} agent-managed playlist(s) missing XML NODEs. fix: megadj rb-playlist reconcile <drive> --apply --yes`,
    fix:
      ok && !unknownXml
        ? undefined
        : unknownXml
          ? undefined
          : "run: megadj rb-playlist reconcile <drive> --apply --yes (rekordbox quit)",
  };
}
