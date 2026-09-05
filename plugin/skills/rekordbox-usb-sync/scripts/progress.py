#!/usr/bin/env python3
"""Terminal progress bar with ETA + rate for the rekordbox-usb-sync scripts.

Zero dependencies. Renders a single updating line on a TTY:

    Contents copy | [########--------] 1450/3794 files · 1.2/4.5 GB · 27% · 4.2 MB/s · ETA 03:12

When stdout is not a TTY (piped to a log), prints one plain line every 5%
instead so `tail -f` still shows movement.
"""

import sys
import time


def fmt_bytes(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024 or unit == "TB":
            return f"{int(n)} B" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} TB"


def fmt_dur(seconds: float) -> str:
    s = int(seconds)
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    if h:
        return f"{h}:{m:02d}:{sec:02d}"
    return f"{m:02d}:{sec:02d}"


class Progress:
    """Track items (+ optional bytes) and render a live bar with ETA."""

    def __init__(
        self,
        total: int,
        label: str = "",
        unit: str = "files",
        total_bytes: int | None = None,
        initial: int = 0,
    ):
        self.total = max(total, 1)
        self.label = label
        self.unit = unit
        self.total_bytes = total_bytes
        self.done = initial
        self.bytes_done = 0
        self.start = time.monotonic()
        self._last_render = 0.0
        self._last_plain = -1
        self.is_tty = sys.stdout.isatty()

    def update(self, n: int = 1, nbytes: int = 0) -> None:
        self.done += n
        self.bytes_done += nbytes
        self.render()

    def render(self, force: bool = False) -> None:
        now = time.monotonic()
        if not force and now - self._last_render < 0.25:
            return
        self._last_render = now
        elapsed = now - self.start
        if not self.is_tty:
            pct = self.done * 100 // self.total
            if pct >= self._last_plain + 5 or force:
                self._last_plain = pct
                print(
                    f"[{self.label}] {self.done}/{self.total} {self.unit} · {self._suffix(elapsed)}",
                    flush=True,
                )
            return
        width = 24
        filled = int(width * min(self.done / self.total, 1.0))
        bar = "#" * filled + "-" * (width - filled)
        line = f"[{bar}] {self.done}/{self.total} {self.unit} · {self._suffix(elapsed)}"
        if self.label:
            line = f"{self.label} | {line}"
        sys.stdout.write("\r\033[K" + line[:120])
        sys.stdout.flush()

    def _suffix(self, elapsed: float) -> str:
        parts = [f"{min(self.done * 100 // self.total, 100):3d}%"]
        if self.total_bytes:
            parts.append(
                f"{fmt_bytes(self.bytes_done)} / {fmt_bytes(self.total_bytes)}"
            )
            if elapsed > 1 and self.bytes_done > 0:
                parts.append(f"{fmt_bytes(self.bytes_done / elapsed)}/s")
        if elapsed > 2 and self.done > 0:
            remaining = (elapsed / self.done) * (self.total - self.done)
            parts.append("ETA " + fmt_dur(remaining))
        return " · ".join(parts)

    def close(self, message: str | None = None) -> None:
        elapsed = time.monotonic() - self.start
        self.render(force=True)
        if self.is_tty:
            sys.stdout.write("\n")
            sys.stdout.flush()
        summary = f"[{self.label or 'done'}] {self.done}/{self.total} {self.unit} in {fmt_dur(elapsed)}"
        if self.total_bytes and elapsed > 0:
            summary += f" ({fmt_bytes(self.bytes_done)} at {fmt_bytes(self.bytes_done / elapsed)}/s)"
        print(summary, flush=True)
        if message:
            print(message, flush=True)


class Stage:
    """Named stage banners so multi-step runs read like a job log."""

    def __init__(self) -> None:
        self.n = 0
        self.start = time.monotonic()

    def step(self, name: str) -> None:
        self.n += 1
        print(
            f"\n=== [{self.n}] {name}  (t+{fmt_dur(time.monotonic() - self.start)}) ===",
            flush=True,
        )

    def info(self, msg: str) -> None:
        print(f"    {msg}", flush=True)
