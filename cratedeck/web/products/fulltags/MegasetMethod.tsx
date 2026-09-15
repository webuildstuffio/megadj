/** Read-only evidence panel for the set builder. Kept separate from the
 * interactive SimilarTab so source/check wording cannot bury its state flow. */
export function MegasetMethod() {
  return (
    <details class="megaset-method">
      <summary>
        <span>How FullTags scores this proposal</span>
        <small>read-only</small>
      </summary>
      <dl class="megaset-evidence" aria-label="Set builder evidence">
        <div>
          <dt>Sources</dt>
          <dd>
            Entire downloaded archive DB · mounted shelf files · FullTags
            beat/mood ledgers first · current Rekordbox master BPM/key fallback
            · live file key tags only when neither source knows the key
          </dd>
        </div>
        <div>
          <dt>Checks</dt>
          <dd>
            File exists · duplicate paths collapse · ±6% tempo window ·
            Camelot-compatible key moves · selected energy arc
          </dd>
        </div>
        <div>
          <dt>Output</dt>
          <dd>
            Writes no tags or playlists. Save downloads a local review draft;
            export downloads an importable M3U8 without opening its database
          </dd>
        </div>
      </dl>
    </details>
  );
}
