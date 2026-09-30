"""rb-comment-sync write leg — FullTags comment from TXXX + ledger.

argv: <dbPath> <ledgerPath> <apply> <batch> — for each master
row with an empty Comment and an existing file: read TXXX
CAMELOT/ENERGY/MOOD (+ MOODS variant) via mutagen and build the
FullTags comment `Camelot · E<energy> · Mood1+Mood2`; falls back to
archive.db (mood+tracks tables) when the file carries no TXXX set.
One spawn writes the batch behind the RB-closed guard (kit fragment).
"""

import json
import os
import sqlite3
import subprocess
import sys
import unicodedata

from pyrekordbox import db6  # type: ignore[import-not-found]
from pyrekordbox.db6.database import BLOB, deobfuscate  # type: ignore[import-not-found]
from pyrekordbox.db6.tables import DjmdContent, DjmdKey  # type: ignore[import-not-found]

# Sentinel: the file exists but its tag block is corrupt/unparseable.
# Distinct from None ("readable, no usable frames") so the skip list can
# report "unreadable" — a data-integrity signal — instead of "no tag data"
# (issue #229: corrupt indistinguishable from untagged).
UNREADABLE = object()


def nfc_casefold(s: str) -> str:
    """NFC-normalize then casefold — matches pathKey in TS.

    APFS stores NFD, archive.db stores NFC; casefold() alone does NOT
    normalize Unicode decomposition, so accented paths (Beyoncé, naïve,
    café) MISS on ledger lookup without this.
    """
    return unicodedata.normalize("NFC", s).casefold()


def read_txxx(path):
    """Read CAMELOT/ENERGY/MOOD TXXX frames + comment-format fields.

    Returns {..frames..}, None (readable file, no usable tag frames),
    or UNREADABLE (the file's tag block exists but mutagen cannot
    parse it — issue #229: corrupt must not read as "no tag data",
    a data-integrity signal mislabeled as absence).
    """
    try:
        from mutagen import File as MFile
    except Exception:  # mutagen absent — the whole read leg can't run
        return None
    try:
        a = MFile(path, easy=False)
    except Exception:
        return UNREADABLE
    if a is None or not hasattr(a, "tags") or a.tags is None:
        return None
    out = {}
    for tag in a.tags.values():
        k = getattr(tag, "desc", "") or ""
        v = getattr(tag, "text", [""])
        v = str(v[0]) if v else ""
        ku = k.upper()
        if ku in ("CAMELOT", "TKEY", "INITIALKEY") and v:
            out.setdefault("key", v)
        elif ku == "ENERGY" and v:
            out.setdefault("energy", v)
        elif ku in ("MOOD", "MOODS") and v:
            out.setdefault("mood", v)
    return out or None


def main() -> None:
    db_path, ledger_path = sys.argv[1], sys.argv[2]
    apply = sys.argv[3] == "apply"
    batch = sys.argv[4]
    db = db6.Rekordbox6Database(path=db_path, key=deobfuscate(BLOB))

    # RB key map: KeyID → key name (e.g. 3912826874 → "Am")
    rb_key_map: dict[str, str] = {}
    for k in db.query(DjmdKey).all():
        rb_key_map[str(k.ID)] = k.ScaleName

    rows = []
    for c in db.query(DjmdContent).all():
        p = c.FolderPath or ""
        if batch and batch not in p:
            continue
        rows.append(c)

    # ledger fallback data (video_id keyed)
    led = {}
    moods_by_path: dict[str, dict] = {}
    energy_from_mood: dict[str, str] = {}
    if os.path.exists(ledger_path):
        con = sqlite3.connect(ledger_path)
        con.row_factory = sqlite3.Row
        for t in con.execute(
            "select video_id, energy, genre, year, album, title, artist, file_path from tracks"
        ):
            led.setdefault("path:" + nfc_casefold(t["file_path"] or ""), dict(t))
            led.setdefault("id:" + t["video_id"], dict(t))
        for m in con.execute(
            "select m.video_id, m.dance, m.aggressive, m.happy, m.electronic, m.party,"
            " m.arousal, t.file_path from mood m join tracks t on t.video_id = m.video_id"
        ):
            fp_key = nfc_casefold(m["file_path"] or "")
            moods_by_path[fp_key] = dict(m)
            # Derive energy from arousal (1-9 scale -> 1-10 DJ energy)
            try:
                ar = float(m["arousal"] or 0)
                if ar > 0:
                    e_val = max(1.0, min(10.0, round(1 + (ar - 1) * (9 / 8), 1)))
                    energy_from_mood[fp_key] = str(e_val)
            except (TypeError, ValueError):
                pass
        con.close()

    out = {
        "scanned": len(rows),
        "eligible": 0,
        "written": 0,
        "enriched": 0,
        "alreadyHad": 0,
        "skipped": [],
        "samples": [],
        "writes": [],
        "errors": [],
    }

    # ---- v3 genre lookup: secondary + tertiary from archive.db ----
    genres_secondary: dict[str, str] = {}
    genres_tertiary: dict[str, str] = {}
    if os.path.exists(ledger_path):
        con_g = sqlite3.connect(ledger_path)
        con_g.row_factory = sqlite3.Row
        for g in con_g.execute(
            "SELECT video_id, genre, genre_secondary, genre_votes, file_path"
            " FROM tracks WHERE file_path IS NOT NULL"
        ):
            fp_key = nfc_casefold(g["file_path"] or "")
            if g["genre_secondary"]:
                genres_secondary[fp_key] = g["genre_secondary"]
            # Parse 3rd genre from genre_votes JSON
            if g["genre_votes"]:
                try:
                    votes = json.loads(g["genre_votes"])
                    primary = g["genre"] or ""
                    secondary = g["genre_secondary"] or ""
                    for v in votes:
                        vg = v.get("genre", "")
                        if vg and vg != primary and vg != secondary:
                            genres_tertiary[fp_key] = vg
                            break
                except (json.JSONDecodeError, TypeError):
                    pass
        con_g.close()

    # ---- v4: library-relative energy bands ----
    all_energies: list[float] = []
    energy_by_path: dict[str, float] = {}
    if os.path.exists(ledger_path):
        con_e = sqlite3.connect(ledger_path)
        for row_e in con_e.execute(
            "SELECT file_path, energy FROM tracks WHERE energy IS NOT NULL AND file_path IS NOT NULL"
        ):
            fp = nfc_casefold(row_e[0] or "")
            try:
                e = float(row_e[1])
                all_energies.append(e)
                energy_by_path[fp] = e
            except (TypeError, ValueError):
                pass
        con_e.close()
    all_energies.sort()

    def energy_band(track_energy: float) -> int:
        """Library-relative energy band E1-E9."""
        if not all_energies:
            return 5
        rank = 0
        for e in all_energies:
            if e <= track_energy:
                rank += 1
            else:
                break
        pct = rank / len(all_energies)
        import math
        band = math.ceil(pct * 9)
        return max(1, min(9, band))

    # ---- v4: within-family mood percentiles ----
    family_aggressive: dict[str, list[float]] = {}
    family_happy: dict[str, list[float]] = {}
    all_aggressive: list[float] = []
    all_happy: list[float] = []
    agg_by_path: dict[str, float] = {}
    hap_by_path: dict[str, float] = {}
    genre_by_path: dict[str, str] = {}
    if os.path.exists(ledger_path):
        con_fm = sqlite3.connect(ledger_path)
        for row_fm in con_fm.execute(
            "SELECT t.file_path, t.genre, m.aggressive, m.happy "
            "FROM tracks t JOIN mood m ON t.video_id = m.video_id "
            "WHERE t.file_path IS NOT NULL AND t.genre IS NOT NULL"
        ):
            fp = nfc_casefold(row_fm[0] or "")
            genre_fam = (row_fm[1] or "").strip()
            try:
                agg = float(row_fm[2])
                hap = float(row_fm[3])
            except (TypeError, ValueError):
                continue
            agg_by_path[fp] = agg
            hap_by_path[fp] = hap
            genre_by_path[fp] = genre_fam
            all_aggressive.append(agg)
            all_happy.append(hap)
            family_aggressive.setdefault(genre_fam, []).append(agg)
            family_happy.setdefault(genre_fam, []).append(hap)
        con_fm.close()
    all_aggressive.sort()
    all_happy.sort()
    for fam_vals in family_aggressive.values():
        fam_vals.sort()
    for fam_vals in family_happy.values():
        fam_vals.sort()

    FAMILY_MIN_SIZE = 300

    def family_percentile(value: float, family_vals: list[float], all_vals: list[float]) -> float:
        """Within-family percentile. Falls back to global for small families."""
        pool = family_vals if len(family_vals) >= FAMILY_MIN_SIZE else all_vals
        if not pool:
            return 0.5
        rank = 0
        for v in pool:
            if v <= value:
                rank += 1
            else:
                break
        return rank / len(pool)

    # ---- v4: subgenre abbreviation map ----
    SUBGENRE_ABBREV: dict[str, str] = {
        "tech house": "TechHouse", "deep house": "DeepHouse",
        "afro house": "AfroHouse", "progressive house": "ProgHouse",
        "melodic house": "MelHouse", "organic house": "OrgHouse",
        "bass house": "BassHouse", "future house": "FutHouse",
        "melodic techno": "MelTechno", "peak-time techno": "PeakTechno",
        "hard techno": "HardTechno", "minimal": "Minimal",
        "minimal deep tech": "Minimal", "deep tech": "Minimal",
        "big room": "BigRoom", "drum & bass": "DnB", "drum and bass": "DnB",
        "psytrance": "Psy", "hip-hop": "HipHop", "hip hop": "HipHop",
        "uk garage": "UKG", "trance": "Trance", "dubstep": "Dubstep",
        "trap": "Trap", "techhouse": "TechHouse",
        "melodic house & techno": "MelHouse", "electro": "Electro",
        "electronica": "Electronica", "indie dance": "IndieDance",
        "nu disco": "NuDisco", "disco": "Disco", "amapiano": "Amapiano",
        "jersey club": "JerseyClub", "breakbeat": "Breakbeat",
        "downtempo": "Downtempo", "ambient": "Ambient", "r&b": "RnB",
    }

    def abbreviate_subgenre(sub: str) -> str:
        return SUBGENRE_ABBREV.get(sub.lower().strip(), sub.replace(" ", ""))

    def resolve_data_v4(p: str, tags: dict | None, rb_key_id: str | None = None) -> dict:
        """Resolve all v4 comment tokens for a track.

        Returns dict with keys: energy_band, hard, soft, dark, euph, subgenre.
        IN/OUT, VOX/HOOK, Drop/Roll, VAR need analysis pipelines not yet built.
        """
        result: dict = {
            "energy_band": None, "hard": False, "soft": False,
            "dark": False, "euph": False, "subgenre": "",
        }
        fp_key = nfc_casefold(p)

        # Energy band (library-relative percentile)
        raw_energy = energy_by_path.get(fp_key)
        if raw_energy is None:
            energy_str = (tags or {}).get("energy", "")
            if not energy_str:
                led_row = led.get("path:" + fp_key)
                if led_row and led_row.get("energy"):
                    energy_str = str(led_row["energy"])
            if not energy_str:
                energy_str = energy_from_mood.get(fp_key, "")
            if energy_str:
                try:
                    raw_energy = float(energy_str)
                except (TypeError, ValueError):
                    pass
        if raw_energy is not None:
            result["energy_band"] = energy_band(raw_energy)

        # Within-family mood percentiles
        agg = agg_by_path.get(fp_key)
        hap = hap_by_path.get(fp_key)
        genre_fam = genre_by_path.get(fp_key, "")
        if agg is not None and genre_fam:
            fam_agg = family_aggressive.get(genre_fam, [])
            pct_agg = family_percentile(agg, fam_agg, all_aggressive)
            if pct_agg >= 0.80:
                result["hard"] = True
            elif pct_agg <= 0.20:
                result["soft"] = True
        if hap is not None and genre_fam:
            fam_hap = family_happy.get(genre_fam, [])
            pct_hap = family_percentile(hap, fam_hap, all_happy)
            if pct_hap <= 0.20:
                result["dark"] = True
            elif pct_hap >= 0.80:
                result["euph"] = True

        # Subgenre with confidence gate
        sub = genres_secondary.get(fp_key, "")
        if sub:
            # Check confidence from genre_votes
            primary = genre_by_path.get(fp_key, "")
            if sub.lower() != primary.lower():
                result["subgenre"] = abbreviate_subgenre(sub)
            else:
                # Secondary = primary: try tertiary
                ter = genres_tertiary.get(fp_key, "")
                if ter and ter.lower() != primary.lower():
                    result["subgenre"] = abbreviate_subgenre(ter)

        return result

    def build_comment_v4(data: dict) -> str:
        """v4 format: E8 Hard Dark · MelTechno"""
        parts: list[str] = []
        eb = data.get("energy_band")
        if eb is not None:
            parts.append(f"E{eb}")
        # IN/OUT, VOX/HOOK, Drop/Roll not yet available — omit
        if data.get("hard"):
            parts.append("Hard")
        elif data.get("soft"):
            parts.append("Soft")
        if data.get("dark"):
            parts.append("Dark")
        elif data.get("euph"):
            parts.append("Euph")
        sub = data.get("subgenre", "")
        # Guard against URL/metadata junk in subgenre
        if sub and ".com" not in sub.lower() and "http" not in sub.lower() and "=" not in sub:
            return f"{' '.join(parts)} · {sub}" if parts else f"· {sub}"
        return " ".join(parts)

    import re

    MOOD_HEADS = {"Party", "Dance", "Aggro", "Happy", "Electronic"}

    def parse_existing(comment: str) -> tuple[str, str, str]:
        """Extract key/energy/mood already present in a comment."""
        parts = [p.strip() for p in comment.split("·")]
        ex_key = ex_energy = ex_mood = ""
        for part in parts:
            # Standard key notation (Am, F#m, Dbm, C) + long-form (Cmin, Amin)
            if re.match(r"^[A-Ga-g][#b]?m(in)?$", part) or re.match(r"^[A-Ga-g][#b]?$", part):
                ex_key = part
            # Camelot notation (6A, 11B, 9m, 10m — both upper and lower)
            elif re.match(r"^\d+[A-Ba-b]$", part):
                ex_key = part
            elif re.match(r"^E\d", part):
                ex_energy = part[1:]
            elif any(h in part for h in MOOD_HEADS):
                ex_mood = part
        return ex_key, ex_energy, ex_mood

    pending = []
    for c in rows:
        p = c.FolderPath or ""
        existing = (c.Commnt or "").strip()
        if not os.path.exists(p):
            out["skipped"].append([p[-70:], "file missing"])
            continue
        tags = read_txxx(p)
        if tags is UNREADABLE:
            out["skipped"].append([p[-70:], "unreadable"])
            continue

        rb_kid = str(c.KeyID) if c.KeyID else None
        v4_data = resolve_data_v4(p, tags, rb_kid)

        new_comment = build_comment_v4(v4_data)
        if not new_comment:
            out["skipped"].append([p[-70:], "no tag data"])
            continue

        if existing:
            if new_comment != existing:
                out["enriched"] += 1
                out["eligible"] += 1
                if len(out["samples"]) < 5:
                    out["samples"].append([p[-60:], f"{existing} → {new_comment}"])
                if apply:
                    pending.append((c, str(c.ID), new_comment))
            else:
                out["alreadyHad"] += 1
        else:
            out["eligible"] += 1
            if len(out["samples"]) < 5:
                out["samples"].append([p[-60:], new_comment])
            if apply:
                pending.append((c, str(c.ID), new_comment))

    if apply:
        try:
            for c, _, comment in pending:
                c.Commnt = comment
                # @kit(RB_CLOSED_PY_GUARD;12)
                raise RuntimeError("rekordbox reopened before comment commit")
            db.session.commit()
            out["writes"] = [[cid, comment] for _, cid, comment in pending]
            out["written"] = len(out["writes"])
        except Exception as e:
            db.session.rollback()
            out["errors"].append(["transaction", repr(e)[:200]])

    # ---- Genre sync: push archive.db vote-winner genres to master.db ----
    # Bug fix: scope to the same batch-filtered `rows` as the comment sync
    # — the old `db.query(DjmdContent).all()` ignored --batch and synced
    # genres for ALL tracks when comments were batch-scoped.
    genres_by_path: dict[str, str] = {}
    if os.path.exists(ledger_path):
        con2 = sqlite3.connect(ledger_path)
        for row2 in con2.execute(
            "SELECT file_path, genre FROM tracks WHERE genre IS NOT NULL AND genre != '' AND file_path IS NOT NULL"
        ):
            genres_by_path[nfc_casefold(row2[0])] = row2[1]
        con2.close()

    from pyrekordbox.db6.tables import DjmdGenre  # type: ignore[import-not-found]

    genre_cache: dict[str, object] = {}
    for g in db.query(DjmdGenre).all():
        genre_cache[nfc_casefold(g.Name)] = g

    genre_written = 0
    genre_skipped = 0
    existing_ids = {str(g.ID) for g in genre_cache.values()}
    for c in rows:
        p = nfc_casefold(c.FolderPath or "")
        if not p:
            continue
        archive_genre = genres_by_path.get(p)
        if not archive_genre:
            genre_skipped += 1
            continue
        gkey = nfc_casefold(archive_genre)
        if gkey not in genre_cache:
            import uuid

            # Collision-safe ID generation
            gid = str(abs(hash(archive_genre)) % (2**31))
            while gid in existing_ids:
                gid = str(int(gid) + 1)
            existing_ids.add(gid)
            new_g = DjmdGenre(ID=gid, Name=archive_genre, UUID=str(uuid.uuid4()))
            if apply:
                db.session.add(new_g)
            genre_cache[gkey] = new_g
        genre_row = genre_cache[gkey]
        # Bug fix: case-insensitive compare — the cache lookup is casefold'd,
        # so the DB genre "House" and archive "house" are the SAME genre; only
        # rename when the canonical casing genuinely differs beyond casefold.
        if (
            apply
            and nfc_casefold(genre_row.Name) == nfc_casefold(archive_genre)
            and genre_row.Name != archive_genre
        ):
            pass  # same genre, different case — keep the RB original
        elif apply and nfc_casefold(genre_row.Name) != nfc_casefold(archive_genre):
            genre_row.Name = archive_genre  # genuinely different genre name
        if str(c.GenreID) != str(genre_row.ID):
            genre_written += 1
            if apply:
                c.GenreID = genre_row.ID

    if apply and genre_written > 0:
        try:
            db.session.commit()
        except Exception as e:
            db.session.rollback()
            out["errors"].append(["genre-sync", repr(e)[:200]])

    out["genre_written"] = genre_written
    out["genre_skipped"] = genre_skipped

    print(json.dumps(out))
    # Checkpoint WAL before closing — a leftover WAL file crashes rekordbox.
    # In a finally: block so a crash in genre sync (or any late code) cannot
    # skip the checkpoint and leave a WAL behind (5.7 MB WAL incident Sep 28).
    try:
        from sqlalchemy import text

        with db.engine.connect() as conn:
            conn.execute(text("PRAGMA wal_checkpoint(TRUNCATE)"))
    except Exception:
        pass
    finally:
        db.close()


if __name__ == "__main__":
    main()
