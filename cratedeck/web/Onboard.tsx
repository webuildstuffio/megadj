// Onboard.tsx — the Welcome-page onboarding: getting-started steps, the
// deep-linkable surface tour, the job cheat-sheet, and the glossary wall.
// All copy comes from the shared help SSOT (shared/help.ts); the inline
// demo chip teaches the (?)-tooltip convention itself.
import { HELP_JOBS, HELP_SURFACES, HELP_TERMS, helpTerm } from "../shared/help";
import { Icon } from "./icons";

/** An inline glossary chip: hover card with the definition + the "why". */
export function GlossTerm(props: { t: string }) {
  const hit = helpTerm(props.t);
  if (!hit) return <b>{props.t}</b>;
  return (
    <span class="gloss">
      <b>{props.t}</b>
      <span class="infotip-card">
        <b>{hit.term}</b>
        <span>{hit.def}</span>
        <span class="infotip-why">
          <Icon name="bolt" size={10} /> {hit.why}
        </span>
      </span>
    </span>
  );
}

export function Onboard() {
  return (
    <div class="onboard">
      <section class="ob-sec">
        <h3 class="sect">
          <Icon name="compass" /> Start here — what CrateDeck does
        </h3>
        <p class="ob-lede">
          CrateDeck watches your DJ USB drives so the booth never surprises you:
          it scans each stick's rekordbox library, audits it for the exact
          failure modes that ruin a set (stale hardware library, missing
          waveforms, silent file corruption, a mirror that drifted), and tells
          you — in plain language — what to fix.
        </p>
        <ol class="ob-steps">
          <li>
            <b>Plug in a drive.</b> It registers on the rail forever — even
            after unmounting it stays as a browsable <GlossTerm t="Ghost" />.
          </li>
          <li>
            <b>Scan it.</b> A first scan happens automatically on mount; scans
            snapshot tracks, playlists and space.
          </li>
          <li>
            <b>Verify it.</b> The deep audit — run it before every gig (there's
            a weekly auto-verify too).
          </li>
          <li>
            <b>Keep the pair honest.</b> Mirror the master, then watch the{" "}
            <GlossTerm t="Redundancy" /> audit so every track lives on both
            sticks.
          </li>
          <li>
            <b>Walk out the door on green.</b> <GlossTerm t="Preflight" /> is
            the last check: every drive ready, or the exact blocker.
          </li>
        </ol>
      </section>

      <section class="ob-sec">
        <h3 class="sect">
          <Icon name="grid" /> Where everything lives
        </h3>
        <div class="ob-tour">
          {HELP_SURFACES.map((s) => (
            <a class="ob-tour-row" href={s.route} key={s.route}>
              <b>{s.label}</b>
              <span class="ob-where">{s.where}</span>
              <span class="ob-q">{s.question}</span>
            </a>
          ))}
        </div>
      </section>

      <section class="ob-sec">
        <h3 class="sect">
          <Icon name="shield" /> The five jobs
        </h3>
        <div class="ob-jobs">
          {HELP_JOBS.map((j) => (
            <div class="ob-job" key={j.kind}>
              <div class="ob-job-head">
                <Icon name={j.icon} size={14} />
                <b>{j.label}</b>
                <span class="ob-dur">{j.duration}</span>
              </div>
              <span class="ob-job-what">{j.what}</span>
              <span class="ob-job-safety">{j.safety}</span>
            </div>
          ))}
        </div>
      </section>

      <section class="ob-sec">
        <h3 class="sect">
          <Icon name="doc" /> Vocabulary
        </h3>
        <p class="ob-lede">
          The words this app uses — every term below also appears as a{" "}
          <span class="infotip demo">
            <span class="infotip-dot" aria-hidden>
              <Icon name="dot" size={9} />
            </span>
            <span class="infotip-card">
              <b>hover cards like this</b>
              <span>
                look for the little dot anywhere in the app — it explains the
                thing it sits next to.
              </span>
            </span>
          </span>{" "}
          throughout the UI.
        </p>
        <div class="ob-gloss">
          {HELP_TERMS.map((t) => (
            <GlossTerm t={t.term} key={t.term} />
          ))}
        </div>
      </section>
    </div>
  );
}
