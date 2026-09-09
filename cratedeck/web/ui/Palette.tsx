// Palette.tsx — the command palette (⌘K). tinykeys owns the global
// shortcut; fuse.js ranks the commands. Every nav target in the suite —
// products, scope tabs, each mounted drive, drive tabs — is one palette
// row away; typing filters fuzzily ("flt" → FullTags, "beat" → Beatgrids).
// Arrow keys move, Enter runs, Escape closes; the row renders aria-selected
// and the listbox is labelled. The palette is a sibling of the header
// search (which searches CRATE CONTENT) — this one navigates SURFACES.
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { tinykeys, type KeybindingHandler } from "tinykeys";
import type { DriveCardData } from "../../shared/types";
import { fuzzyFilter } from "./fuzzy";
import { Icon } from "./icons";
import { navigate, navigateProduct } from "../app/router";

interface Cmd {
  id: string;
  label: string;
  hint: string;
  icon: string;
  keywords: string;
  run: () => void;
}

function commands(drives: DriveCardData[]): Cmd[] {
  const out: Cmd[] = [
    {
      id: "drives",
      label: "Drives — the crate shelf",
      hint: "all drives",
      icon: "usb",
      keywords: "shelf home drives crates",
      run: () => navigateProduct("drives"),
    },
    {
      id: "fleet-coverage",
      label: "Fleet — Coverage",
      hint: "which stick has this track",
      icon: "grid",
      keywords: "coverage single copy at risk",
      run: () => navigateProduct("fleet", "coverage"),
    },
    {
      id: "fleet-redundancy",
      label: "Fleet — Redundancy",
      hint: "survive one drive dying",
      icon: "shield",
      keywords: "redundancy survival audit playlist",
      run: () => navigateProduct("fleet", "redundancy"),
    },
    {
      id: "fleet-diff",
      label: "Fleet — Diff",
      hint: "two drives side by side",
      icon: "sort",
      keywords: "diff compare drives added removed",
      run: () => navigateProduct("fleet", "diff"),
    },
    {
      id: "fleet-preflight",
      label: "Fleet — Preflight",
      hint: "the gig-night gate",
      icon: "bolt",
      keywords: "preflight gig ready gate check",
      run: () => navigateProduct("fleet", "preflight"),
    },
    {
      id: "fleet-archive",
      label: "Fleet — Archive",
      hint: "ingest queue + integrity",
      icon: "doc",
      keywords: "archive ingest queue analysis",
      run: () => navigateProduct("fleet", "archive"),
    },
    {
      id: "fleet-prep",
      label: "Fleet — Prep",
      hint: "weekly digest",
      icon: "doc",
      keywords: "prep weekly digest",
      run: () => navigateProduct("fleet", "prep"),
    },
    {
      id: "getdat-pipeline",
      label: "GetDat — Pipeline",
      hint: "the download machine",
      icon: "refresh",
      keywords: "getdat pipeline download runs throughput",
      run: () => navigateProduct("getdat", "pipeline"),
    },
    {
      id: "getdat-backlog",
      label: "GetDat — Backlog",
      hint: "retries + upgrades",
      icon: "warn",
      keywords: "getdat backlog retry quality",
      run: () => navigateProduct("getdat", "backlog"),
    },
    {
      id: "getdat-sources",
      label: "GetDat — Sources",
      hint: "where music comes from",
      icon: "compass",
      keywords: "getdat sources origin",
      run: () => navigateProduct("getdat", "sources"),
    },
    {
      id: "getdat-library",
      label: "GetDat — Library",
      hint: "the archive, newest first",
      icon: "disc",
      keywords: "getdat library archive search",
      run: () => navigateProduct("getdat", "library"),
    },
    {
      id: "fulltags-beatgrids",
      label: "FullTags — Beatgrids",
      hint: "the beats ledger",
      icon: "pulse",
      keywords: "fulltags beatgrids beats grid crosscheck",
      run: () => navigateProduct("fulltags", "beatgrids"),
    },
    {
      id: "fulltags-mood",
      label: "FullTags — Mood",
      hint: "dance/valence/arousal",
      icon: "bolt",
      keywords: "fulltags mood dance valence arousal",
      run: () => navigateProduct("fulltags", "mood"),
    },
    {
      id: "fulltags-similar",
      label: "FullTags — Similar",
      hint: "sounds-like search",
      icon: "compass",
      keywords: "fulltags similar sounds like embedding",
      run: () => navigateProduct("fulltags", "similar"),
    },
    {
      id: "fulltags-cues",
      label: "FullTags — Cues",
      hint: "phrase-cue ledger",
      icon: "play",
      keywords: "fulltags cues phrase markers",
      run: () => navigateProduct("fulltags", "cues"),
    },
    {
      id: "fulltags-tags",
      label: "FullTags — Tags",
      hint: "the tag mirror",
      icon: "tag",
      keywords: "fulltags tags genres years artwork",
      run: () => navigateProduct("fulltags", "tags"),
    },
  ];
  // one row per known drive (mounted or ghost) + its tabs
  const driveTabs: [string, string, string][] = [
    ["overview", "Overview", "grid"],
    ["playlists", "Playlists", "disc"],
    ["health", "Health", "pulse"],
    ["verify", "Verify", "check"],
    ["timeline", "Timeline", "history"],
  ];
  for (const d of drives) {
    const name = d.nickname ?? d.name;
    out.push({
      id: `drive-${d.id}`,
      label: `Drive — ${name}`,
      hint: d.mounted ? "mounted" : "ghost — last snapshot",
      icon: "usb",
      keywords: `drive ${name} ${d.name ?? ""}`,
      run: () => navigate(d.id),
    });
    for (const [tab, label, icon] of driveTabs) {
      out.push({
        id: `drive-${d.id}-${tab}`,
        label: `${name} — ${label}`,
        hint: `drive ${tab}`,
        icon,
        keywords: `drive ${name} ${label} ${tab}`,
        run: () => navigate(d.id, tab),
      });
    }
  }
  return out;
}

export function Palette(props: {
  drives: DriveCardData[];
  /** close requested by the parent (Escape inside also self-closes) */
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const cmds = useMemo(() => commands(props.drives), [props.drives]);
  const hits = useMemo(() => {
    const rows = fuzzyFilter(cmds, q, ["label", "hint", "keywords"], {
      limit: 12,
    });
    return rows.length > 0 || q ? rows : cmds.slice(0, 12);
  }, [cmds, q]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => inputRef.current?.focus(), []);

  useEffect(() => {
    // tinykeys: scoping the shortcut to the open palette keeps the parent's
    // ⌘K binding from re-triggering while typing
    const unbind = tinykeys(window, {
      Escape: (e: KeyboardEvent) => {
        e.preventDefault();
        props.onClose();
      },
      ArrowDown: (e: KeyboardEvent) => {
        e.preventDefault();
        setSel((s) => Math.min(s + 1, hits.length - 1));
      },
      ArrowUp: (e: KeyboardEvent) => {
        e.preventDefault();
        setSel((s) => Math.max(s - 1, 0));
      },
      Enter: (e: KeyboardEvent) => {
        e.preventDefault();
        const c = hits[sel];
        if (c) {
          props.onClose();
          c.run();
        }
      },
    } satisfies Record<string, KeybindingHandler>);
    return () => unbind();
  }, [hits, sel, props.onClose]);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-idx="${sel}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  return (
    <div class="palette-scrim" onClick={() => props.onClose()}>
      <div
        class="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={(e) => e.stopPropagation()}
      >
        <div class="palette-input">
          <Icon name="search" size={15} />
          <input
            ref={inputRef}
            value={q}
            name="palette-query"
            aria-label="Type a command or destination"
            placeholder="Go to… (drive, tab, fleet scope)"
            onInput={(e) => setQ((e.target as HTMLInputElement).value)}
          />
          <kbd>esc</kbd>
        </div>
        <div class="palette-list" role="listbox" ref={listRef}>
          {hits.length === 0 && (
            <div class="palette-empty">nothing matches — try fewer letters</div>
          )}
          {hits.map((c, i) => (
            <div
              key={c.id}
              data-idx={i}
              role="option"
              aria-selected={i === sel}
              class={`palette-row ${i === sel ? "sel" : ""}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => {
                props.onClose();
                c.run();
              }}
            >
              <Icon name={c.icon} size={14} />
              <span class="palette-label">{c.label}</span>
              <span class="palette-hint">{c.hint}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
