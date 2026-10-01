"""rb-comment-sync write leg — FullTags comment from TXXX + ledger.

argv: <dbPath> <ledgerPath> <apply> <batch> — for each master
row with an empty Comment and an existing file: read TXXX
CAMELOT/ENERGY/MOOD (+ MOODS variant) via mutagen and build the
FullTags comment `Camelot · E<energy> · Mood1+Mood2`; falls back to
archive.db (mood+tracks tables) when the file carries no TXXX set.
One spawn writes the batch behind the RB-closed guard (kit fragment).
"""

import json
import math
import os
import sqlite3
import struct
import subprocess
import sys
import unicodedata
from pathlib import Path

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

    # ---- Single ledger connection for ALL archive.db reads ----
    led: dict[str, dict] = {}
    moods_by_path: dict[str, dict] = {}
    energy_from_mood: dict[str, str] = {}
    genres_secondary: dict[str, str] = {}
    genres_tertiary: dict[str, str] = {}
    all_energies: list[float] = []
    energy_by_path: dict[str, float] = {}
    family_aggressive: dict[str, list[float]] = {}
    family_happy: dict[str, list[float]] = {}
    all_aggressive: list[float] = []
    all_happy: list[float] = []
    agg_by_path: dict[str, float] = {}
    hap_by_path: dict[str, float] = {}
    genre_by_path: dict[str, str] = {}
    var_by_path: dict[str, bool] = {}
    genres_by_path_archive: dict[str, str] = {}
    VAR_THRESHOLD = 15.0
    if os.path.exists(ledger_path):
        con = sqlite3.connect(ledger_path)
        con.row_factory = sqlite3.Row
        for t in con.execute(
            "select video_id, energy, genre, genre_secondary, genre_votes,"
            " year, album, title, artist, file_path from tracks"
            " WHERE file_path IS NOT NULL"
        ):
            fp_key = nfc_casefold(t["file_path"] or "")
            led.setdefault("path:" + fp_key, dict(t))
            led.setdefault("id:" + t["video_id"], dict(t))
            # Energy
            try:
                e = float(t["energy"])
                all_energies.append(e)
                energy_by_path[fp_key] = e
            except (TypeError, ValueError):
                pass
            # Genre for genre sync
            g = t["genre"] or ""
            if g:
                genres_by_path_archive[fp_key] = g
                genre_by_path[fp_key] = g.strip()
            # Secondary/tertiary genre
            if t["genre_secondary"]:
                genres_secondary[fp_key] = t["genre_secondary"]
            if t["genre_votes"]:
                try:
                    votes = json.loads(t["genre_votes"])
                    primary = g
                    secondary = t["genre_secondary"] or ""
                    for v in votes:
                        vg = v.get("genre", "")
                        if vg and vg != primary and vg != secondary:
                            genres_tertiary[fp_key] = vg
                            break
                except (json.JSONDecodeError, TypeError):
                    pass
        for m in con.execute(
            "select m.video_id, m.dance, m.aggressive, m.happy, m.electronic, m.party,"
            " m.arousal, t.file_path, t.genre from mood m"
            " join tracks t on t.video_id = m.video_id"
            " WHERE t.file_path IS NOT NULL"
        ):
            fp_key = nfc_casefold(m["file_path"] or "")
            moods_by_path[fp_key] = dict(m)
            try:
                ar = float(m["arousal"] or 0)
                if ar > 0:
                    e_val = max(1.0, min(10.0, round(1 + (ar - 1) * (9 / 8), 1)))
                    energy_from_mood[fp_key] = str(e_val)
            except (TypeError, ValueError):
                pass
            genre_fam = (m["genre"] or "").strip()
            try:
                agg = float(m["aggressive"])
                hap = float(m["happy"])
            except (TypeError, ValueError):
                continue
            agg_by_path[fp_key] = agg
            hap_by_path[fp_key] = hap
            all_aggressive.append(agg)
            all_happy.append(hap)
            if genre_fam:
                family_aggressive.setdefault(genre_fam, []).append(agg)
                family_happy.setdefault(genre_fam, []).append(hap)
        for row_var in con.execute(
            "SELECT source_path, bpm_residual_std FROM beats"
            " WHERE bpm_residual_std IS NOT NULL AND source_path IS NOT NULL"
        ):
            fp = nfc_casefold(row_var[0] or "")
            try:
                var_by_path[fp] = float(row_var[1]) > VAR_THRESHOLD
            except (TypeError, ValueError):
                pass
        con.close()

    out = {
        "scanned": len(rows),
        "eligible": 0,
        "written": 0,
        "enriched": 0,
        "alreadyHad": 0,
        "anlz_loaded": 0,
        "skipped": [],
        "samples": [],
        "writes": [],
        "errors": [],
    }

    # Pre-sort arrays once (populated in the single-connection block above)
    all_energies.sort()

    from bisect import bisect_right

    def energy_band(track_energy: float) -> int:
        """Library-relative energy band E1-E9 (bisect — O(log n))."""
        if not all_energies:
            return 5
        rank = bisect_right(all_energies, track_energy)
        pct = rank / len(all_energies)
        return max(1, min(9, math.ceil(pct * 9)))

    all_aggressive.sort()
    all_happy.sort()
    for fam_vals in family_aggressive.values():
        fam_vals.sort()
    for fam_vals in family_happy.values():
        fam_vals.sort()

    FAMILY_MIN_SIZE = 300

    def family_percentile(value: float, family_vals: list[float], all_vals: list[float]) -> float:
        """Within-family percentile (bisect — O(log n))."""
        pool = family_vals if len(family_vals) >= FAMILY_MIN_SIZE else all_vals
        if not pool:
            return 0.5
        return bisect_right(pool, value) / len(pool)

    # ---- v4: IN/OUT bars from ANLZ .EXT PSSI phrase data ----
    MIX_WINDOW_STEPS = (0, 8, 16, 32, 64)

    def round_bars_down(bars: int) -> int:
        """Round bar count DOWN to nearest valid step {0,8,16,32,64}."""
        for step in reversed(MIX_WINDOW_STEPS):
            if bars >= step:
                return step
        return 0

    _MASK_BYTES = b"\xcb\xe1\xee\xfa\xe5\xee\xad\xee\xe9\xd2\xe9\xeb\xe1\xe9\xf3\xe8\xe9\xf4\xe1"

    def parse_pssi(data: bytes) -> tuple[int, int, bool, bool] | None:
        """Parse PSSI from .EXT file → (intro_bars, outro_bars, drop, roll) or None."""
        if (
            len(data) < 44
            or data[:4] != b"PMAI"
            or struct.unpack_from(">I", data, 4)[0] != 28
            or data[28:32] != b"PPTH"
        ):
            return None
        off = 44 + struct.unpack_from(">I", data, 40)[0]
        pssi_off = -1
        while off + 12 <= len(data):
            sec_total = struct.unpack_from(">I", data, off + 8)[0]
            if sec_total < 12 or off + sec_total > len(data):
                break
            if data[off : off + 4] == b"PSSI":
                pssi_off = off
                break
            off += sec_total
        if pssi_off < 0:
            return None
        hdr_len, total = struct.unpack_from(">II", data, pssi_off + 4)
        entry_bytes = struct.unpack_from(">I", data, pssi_off + 12)[0]
        num_entries = struct.unpack_from(">H", data, pssi_off + 16)[0]
        if hdr_len != 32 or entry_bytes != 24 or num_entries == 0:
            return None
        body = bytearray(data[pssi_off + 18 : pssi_off + total])
        if struct.unpack_from(">H", data, pssi_off + 18)[0] > 20:  # masked
            mask = bytes((b + num_entries) & 0xFF for b in _MASK_BYTES)
            for i in range(len(body)):
                body[i] ^= mask[i % 19]
        mood = struct.unpack_from(">H", body, 0)[0]
        if mood < 1 or mood > 3:
            return None
        end_beat = struct.unpack_from(">H", body, 8)[0]
        entries = []
        for i in range(num_entries):
            e = 14 + i * 24
            if e + 6 > len(body):
                break
            entries.append(
                (struct.unpack_from(">H", body, e + 2)[0], struct.unpack_from(">H", body, e + 4)[0])
            )

        intro_kind = 1
        outro_kind = 6 if mood == 1 else 10
        chorus_kind = 5 if mood == 1 else 9

        intro_bars = 0
        outro_bars = 0
        has_drop = False
        body_count = 0
        for idx, (beat, kind) in enumerate(entries):
            next_beat = entries[idx + 1][0] if idx + 1 < len(entries) else end_beat
            bars = (next_beat - beat) // 4
            if kind == intro_kind and intro_bars == 0:
                intro_bars = bars
            if kind == outro_kind:
                outro_bars = bars
            if kind == chorus_kind and bars >= 8:
                has_drop = True
            if kind not in (intro_kind, outro_kind):
                body_count += 1
        has_roll = not has_drop and body_count >= 2

        return (intro_bars, outro_bars, has_drop, has_roll)

    def parse_anlz_path(data: bytes) -> str | None:
        """Extract the device-relative audio path from ANLZ PPTH section."""
        if len(data) < 44 or data[:4] != b"PMAI" or data[28:32] != b"PPTH":
            return None
        path_len = struct.unpack_from(">I", data, 40)[0]
        if path_len == 0 or 44 + path_len > len(data):
            return None
        raw = data[44 : 44 + path_len].decode("utf-16-be", errors="replace")
        return raw.rstrip("\x00")

    inout_by_path: dict[str, tuple[int, int, bool, bool]] = {}
    db_path_str = sys.argv[1] if len(sys.argv) > 1 else ""
    # master.db lives at <mount>/PIONEER/Master/master.db
    # USBANLZ lives at <mount>/PIONEER/USBANLZ/
    pioneer_dir = os.path.dirname(os.path.dirname(db_path_str))
    shelf_mount = os.path.dirname(pioneer_dir) if pioneer_dir else ""
    anlz_base = os.path.join(pioneer_dir, "USBANLZ") if pioneer_dir else ""
    if anlz_base and os.path.isdir(anlz_base):
        for top_dir in sorted(os.listdir(anlz_base)):
            top_path = os.path.join(anlz_base, top_dir)
            if not top_dir.startswith("P0") or not os.path.isdir(top_path):
                continue
            for sub_dir in os.listdir(top_path):
                ext_file = os.path.join(top_path, sub_dir, "ANLZ0000.EXT")
                if not os.path.isfile(ext_file):
                    continue
                try:
                    ext_data = Path(ext_file).read_bytes()
                    anlz_path = parse_anlz_path(ext_data)
                    if not anlz_path:
                        continue
                    bars = parse_pssi(ext_data)
                    if bars is None:
                        continue
                    full_path = os.path.join(shelf_mount, anlz_path.lstrip("/"))
                    inout_by_path[nfc_casefold(full_path)] = bars
                except (OSError, struct.error):
                    pass
    out["anlz_loaded"] = len(inout_by_path)

    # ---- v4: subgenre abbreviation map ----
    SUBGENRE_ABBREV: dict[str, str] = {
        "tech house": "TechHouse",
        "deep house": "DeepHouse",
        "afro house": "AfroHouse",
        "progressive house": "ProgHouse",
        "melodic house": "MelHouse",
        "organic house": "OrgHouse",
        "bass house": "BassHouse",
        "future house": "FutHouse",
        "melodic techno": "MelTechno",
        "peak-time techno": "PeakTechno",
        "hard techno": "HardTechno",
        "minimal": "Minimal",
        "minimal deep tech": "Minimal",
        "deep tech": "Minimal",
        "big room": "BigRoom",
        "drum & bass": "DnB",
        "drum and bass": "DnB",
        "psytrance": "Psy",
        "hip-hop": "HipHop",
        "hip hop": "HipHop",
        "uk garage": "UKG",
        "trance": "Trance",
        "dubstep": "Dubstep",
        "trap": "Trap",
        "techhouse": "TechHouse",
        "melodic house & techno": "MelHouse",
        "electro": "Electro",
        "electronica": "Electronica",
        "indie dance": "IndieDance",
        "nu disco": "NuDisco",
        "disco": "Disco",
        "amapiano": "Amapiano",
        "jersey club": "JerseyClub",
        "breakbeat": "Breakbeat",
        "downtempo": "Downtempo",
        "ambient": "Ambient",
        "r&b": "RnB",
        "edm/bass": "EDMBass",
        "hip-hop & rap": "HipHop",
        "hip-hop&rap": "HipHop",
        "alternative rock": "AltRock",
        "contemporary r&b": "RnB",
        "soulful house": "SoulHouse",
    }

    def abbreviate_subgenre(sub: str) -> str:
        lower = sub.lower().strip()
        if lower in SUBGENRE_ABBREV:
            return SUBGENRE_ABBREV[lower]
        import re as _re
        import unicodedata

        nfkd = unicodedata.normalize("NFKD", sub)
        ascii_only = nfkd.encode("ascii", "ignore").decode("ascii")
        return _re.sub(r"[\s/']+", "", ascii_only)

    def resolve_data_v4(p: str, tags: dict | None, rb_key_id: str | None = None) -> dict:
        """Resolve all v4 comment tokens for a track.

        Returns dict with keys: energy_band, intro_bars, outro_bars,
        drop, roll, hard, soft, dark, euph, var_tempo, subgenre.
        VOX/HOOK needs vocal stem separation pipeline.
        """
        result: dict = {
            "energy_band": None,
            "intro_bars": None,
            "outro_bars": None,
            "drop": False,
            "roll": False,
            "hard": False,
            "soft": False,
            "dark": False,
            "euph": False,
            "var_tempo": False,
            "subgenre": "",
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

        # IN/OUT bars + Drop/Roll from ANLZ phrase data
        inout = inout_by_path.get(fp_key)
        if inout is not None:
            result["intro_bars"] = round_bars_down(inout[0])
            result["outro_bars"] = round_bars_down(inout[1])
            result["drop"] = inout[2]
            result["roll"] = inout[3]

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

        # Subgenre: secondary + tertiary when both differ from primary
        sub = genres_secondary.get(fp_key, "")
        primary = genre_by_path.get(fp_key, "")
        ter = genres_tertiary.get(fp_key, "")
        if sub and sub.lower() != primary.lower():
            abbr = abbreviate_subgenre(sub)
            # Append tertiary if it differs from both primary and secondary
            if ter and ter.lower() != primary.lower() and ter.lower() != sub.lower():
                abbr2 = abbreviate_subgenre(ter)
                if abbr2 != abbr:
                    abbr = f"{abbr}+{abbr2}"
            result["subgenre"] = abbr
        elif ter and ter.lower() != primary.lower():
            result["subgenre"] = abbreviate_subgenre(ter)

        # VAR (variable tempo) from bpm_residual_std
        result["var_tempo"] = var_by_path.get(fp_key, False)

        return result

    def build_comment_v4(data: dict) -> str:
        """v4 format: E8 IN:32 OUT:16 Drop Dark · MelTechno+DeepHouse"""
        parts: list[str] = []
        eb = data.get("energy_band")
        if eb is not None:
            parts.append(f"E{eb}")
        ib = data.get("intro_bars")
        ob = data.get("outro_bars")
        if ib is not None and ob is not None:
            parts.append(f"IN:{ib}")
            parts.append(f"OUT:{ob}")
        # VOX/HOOK not yet available — omit
        if data.get("drop"):
            parts.append("Drop")
        elif data.get("roll"):
            parts.append("Roll")
        if data.get("hard"):
            parts.append("Hard")
        elif data.get("soft"):
            parts.append("Soft")
        if data.get("dark"):
            parts.append("Dark")
        elif data.get("euph"):
            parts.append("Euph")
        if data.get("var_tempo"):
            parts.append("VAR")
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
    # genres_by_path_archive was populated in the single-connection block above

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
        archive_genre = genres_by_path_archive.get(p)
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

    # ---- Track Color: energy band → ColorID ----
    # Matches colour-energy.ts energyToColour (SSOT).
    # Blue(7)=E1-E2, Aqua(6)=E3-E4, Green(5)=E5-E6, Orange(3)=E7-E8, Red(2)=E9
    # Pink(1) and Purple(8) are manual — never overwrite.
    ENERGY_TO_COLOR: dict[int, int] = {
        1: 7,
        2: 7,
        3: 6,
        4: 6,
        5: 5,
        6: 5,
        7: 3,
        8: 3,
        9: 2,
    }
    MANUAL_COLORS = {1, 8}  # Pink, Purple — user-managed
    color_written = 0
    color_skipped = 0
    # Color ALL rows from energy_by_path — no redundant resolve_data_v4 calls
    for c in rows:
        fp_key = nfc_casefold(c.FolderPath or "")
        eb_raw = energy_by_path.get(fp_key)
        if eb_raw is None:
            continue
        eb = energy_band(eb_raw)
        target_color = ENERGY_TO_COLOR.get(eb, 0)
        current_color = int(c.ColorID or 0)
        if current_color in MANUAL_COLORS:
            color_skipped += 1
            continue
        if current_color != target_color:
            if apply:
                c.ColorID = target_color
            color_written += 1
    if apply and color_written > 0:
        try:
            db.session.commit()
        except Exception as e:
            db.session.rollback()
            out["errors"].append(["color-sync", repr(e)[:200]])
    out["color_written"] = color_written
    out["color_skipped"] = color_skipped

    # ---- My Tags: mood/structure/genre tags for Track Filter ----
    from pyrekordbox.db6.tables import DjmdMyTag, DjmdSongMyTag  # type: ignore[import-not-found]

    # Load existing tags and categories
    existing_tags: dict[str, object] = {}
    for mt in db.query(DjmdMyTag).all():
        existing_tags[mt.Name] = mt

    # Our v4 categories and their tags
    V4_CATEGORIES: dict[str, list[str]] = {
        "Energy": ["Hard", "Soft", "Mid"],
        "Mood": ["Dark", "Euph", "Neutral"],
        "Tempo": ["VAR"],
    }

    # Create missing categories and tags
    import uuid as _uuid

    max_cat_seq = max(
        (int(mt.Seq or 0) for mt in db.query(DjmdMyTag).filter(DjmdMyTag.ParentID == "root").all()),
        default=4,
    )
    for cat_name, tag_names in V4_CATEGORIES.items():
        if cat_name not in existing_tags:
            max_cat_seq += 1
            cat_id = str(abs(hash(f"v4cat-{cat_name}")) % (2**31))
            new_cat = DjmdMyTag(
                ID=cat_id,
                Name=cat_name,
                ParentID="root",
                Seq=max_cat_seq,
                Attribute=1,
                UUID=str(_uuid.uuid4()),
            )
            if apply:
                db.session.add(new_cat)
            existing_tags[cat_name] = new_cat
        cat_obj = existing_tags[cat_name]
        cat_id_str = str(cat_obj.ID)
        max_tag_seq = max(
            (
                int(mt.Seq or 0)
                for mt in db.query(DjmdMyTag).filter(DjmdMyTag.ParentID == cat_id_str).all()
            ),
            default=0,
        )
        for tag_name in tag_names:
            if tag_name not in existing_tags:
                max_tag_seq += 1
                tag_id = str(abs(hash(f"v4tag-{cat_name}-{tag_name}")) % (2**31))
                new_tag = DjmdMyTag(
                    ID=tag_id,
                    Name=tag_name,
                    ParentID=cat_id_str,
                    Seq=max_tag_seq,
                    Attribute=0,
                    UUID=str(_uuid.uuid4()),
                )
                if apply:
                    db.session.add(new_tag)
                existing_tags[tag_name] = new_tag

    if apply:
        try:
            db.session.commit()
        except Exception as e:
            db.session.rollback()
            out["errors"].append(["mytag-categories", repr(e)[:200]])

    # Assign tags to tracks
    # Build a set of existing assignments to avoid duplicates
    existing_assignments: set[tuple[str, str]] = set()
    for smt in db.query(DjmdSongMyTag).all():
        existing_assignments.add((str(smt.MyTagID), str(smt.ContentID)))

    mytag_written = 0
    for c in rows:
        p = c.FolderPath or ""
        if not os.path.exists(p):
            continue
        fp_key = nfc_casefold(p)
        content_id = str(c.ID)

        # Determine which tags this track should have
        track_tags: list[str] = []
        agg_val = agg_by_path.get(fp_key)
        hap_val = hap_by_path.get(fp_key)
        gfam = genre_by_path.get(fp_key, "")
        if agg_val is not None and gfam:
            fam_agg = family_aggressive.get(gfam, [])
            pct = family_percentile(agg_val, fam_agg, all_aggressive)
            if pct >= 0.80:
                track_tags.append("Hard")
            elif pct <= 0.20:
                track_tags.append("Soft")
            else:
                track_tags.append("Mid")
        if hap_val is not None and gfam:
            fam_hap = family_happy.get(gfam, [])
            pct = family_percentile(hap_val, fam_hap, all_happy)
            if pct <= 0.20:
                track_tags.append("Dark")
            elif pct >= 0.80:
                track_tags.append("Euph")
            else:
                track_tags.append("Neutral")
        if var_by_path.get(fp_key, False):
            track_tags.append("VAR")

        # Write assignments
        for tag_name in track_tags:
            tag_obj = existing_tags.get(tag_name)
            if tag_obj is None:
                continue
            tag_id = str(tag_obj.ID)
            if (tag_id, content_id) in existing_assignments:
                continue
            if apply:
                smt_id = str(abs(hash(f"smt-{tag_id}-{content_id}")) % (2**31))
                new_smt = DjmdSongMyTag(
                    ID=smt_id,
                    MyTagID=tag_id,
                    ContentID=content_id,
                    TrackNo=0,
                    UUID=str(_uuid.uuid4()),
                )
                db.session.add(new_smt)
            existing_assignments.add((tag_id, content_id))
            mytag_written += 1

    if apply and mytag_written > 0:
        try:
            db.session.commit()
        except Exception as e:
            db.session.rollback()
            out["errors"].append(["mytag-assign", repr(e)[:200]])

    out["mytag_written"] = mytag_written

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
