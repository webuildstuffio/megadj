# tools/legacy

Dormant tooling kept for recoverability, not maintained by the gates
(excluded from `mypy` `files` and `ruff` globs — see `pyproject.toml`).

- **`rb_art.py`** (+ `rb_art_test.py`) — legacy WAV artwork DB-surgery path
  (`djmdContent.ImagePath` writes via pyrekordbox). Retired Sep 15 2026:
  every new WAV converts to AIFF at ingest (`docs/fulltags/intake.md`,
  `docs/fulltags/rekordbox-wav-artwork.md`), so this path has no workload.
  If a legacy-WAV edge case ever resurfaces: `git mv` back to `tools/`,
  re-add the file to the `typecheck:py`/`lint:py`/`format:py` globs in
  `package.json`, and restore `"tools"` to mypy `files` in
  `pyproject.toml`. Runbook: `docs/fulltags/rekordbox-wav-artwork.md`.
