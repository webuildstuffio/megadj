/** Python fragment shared by the cue repair and doctor health probe. */
export function incidentCuePredicatePython(): string {
  return `
incident_start = datetime.datetime(2026, 9, 12, 10, 43, 0)
incident_end = datetime.datetime(2026, 9, 12, 10, 57, 0)
incident_labels = {"IN", "BODY", "BUILD", "BUILD2", "DROP1", "DROP2", "BRK1", "BRK2", "OUT"}
incident_colors = {1, 3, 5, 6}

def is_incident_cue(cue):
    created = cue.created_at
    if created is None or not (incident_start <= created < incident_end):
        return False
    if (cue.Comment or "").strip().upper() not in incident_labels:
        return False
    if cue.Color not in incident_colors:
        return False
    if cue.ColorTableIndex is not None or cue.ActiveLoop is not None or cue.BeatLoopSize is not None:
        return False
    content_path = content_paths.get(str(cue.ContentID), "")
    if not content_path:
        return False
    try:
        return os.path.commonpath([contents, os.path.normpath(content_path)]) == contents
    except ValueError:
        return False
`;
}
