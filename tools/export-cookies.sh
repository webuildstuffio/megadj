#!/bin/bash
# Export YouTube cookies from Chrome into a netscape-format jar for
# headless megadj runs (survives when the browser is closed).
#
# SECURITY: the jar contains live session cookies — it lives outside any
# repo, is chmod 600, and must never be committed anywhere.
set -euo pipefail

JAR="${1:-$HOME/.config/megadj/cookies.txt}"
mkdir -p "$(dirname "$JAR")"
chmod 700 "$(dirname "$JAR")"

# yt-dlp is a uv-managed tool; run the export with its own interpreter.
# Locate it portably — works with the default `uv tool install` layout or
# whatever python has yt_dlp importable on PATH.
if [ -z "${YTDLP_PYTHON:-}" ]; then
  for c in "$HOME/.local/share/uv/tools/yt-dlp/bin/python" \
           "$(command -v python3 || true)"; do
    if [ -n "$c" ] && "$c" -c "import yt_dlp" >/dev/null 2>&1; then
      YTDLP_PYTHON="$c"
      break
    fi
  done
fi
if [ -z "${YTDLP_PYTHON:-}" ]; then
  echo "error: no python with yt_dlp found (set YTDLP_PYTHON or uv tool install 'yt-dlp[default]')" >&2
  exit 1
fi

"$YTDLP_PYTHON" - "$JAR" <<'PYEOF'
import sys
jar_path = sys.argv[1]
from yt_dlp import YoutubeDL

ydl_opts = {"cookiefile": None, "cookiesfrombrowser": ("chrome", None, None, None), "quiet": True}
with YoutubeDL(ydl_opts) as ydl:
    jar = ydl.cookiejar
    with open(jar_path, "w") as f:
        f.write("# Netscape HTTP Cookie File\n")
        for c in jar:
            secure = "TRUE" if c.secure else "FALSE"
            domain = c.domain
            include_sub = "TRUE" if domain.startswith(".") else "FALSE"
            f.write(f"{domain}\t{include_sub}\t{c.path}\t{secure}\t{int(c.expires or 0)}\t{c.name}\t{c.value}\n")
print("jar written")
PYEOF

chmod 600 "$JAR"
echo "cookies exported to $JAR ($(( $(grep -c . "$JAR") - 1 )) cookie(s))"
