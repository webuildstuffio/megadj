import { describe, expect, test } from "bun:test";
import render from "preact-render-to-string";
import type { Job } from "../../shared/types";
import { IntakeRun, IntakeVerdict } from "../products/getdat/IntakeTab";

const corruptDoneJob: Job = {
  id: "intake-corrupt",
  drive_id: "archive",
  kind: "ingest",
  status: "done",
  progress: 1,
  message: null,
  phase: "audit",
  eta_seconds: null,
  error: null,
  result_json: "{broken",
  log_path: null,
  created_at: 1,
  started_at: 1,
  finished_at: 2,
};

describe("Intake corrupt result UX", () => {
  test("done verdict explicitly says its result is unreadable", () => {
    const html = render(<IntakeVerdict job={corruptDoneJob} />);
    expect(html).toContain("result unreadable");
    expect(html).not.toContain("all playable");
  });

  test("pipeline shows unreadable instead of a false 100% completion", () => {
    const html = render(
      <IntakeRun job={corruptDoneJob} folder="" onDone={() => undefined} />,
    );
    expect(html).toContain("Result unreadable");
    expect(html).not.toContain(">100%</span>");
    expect(html).toContain("intake-step failed");
  });
});
