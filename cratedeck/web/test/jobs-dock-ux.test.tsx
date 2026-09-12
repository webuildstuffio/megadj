import { describe, expect, test } from "bun:test";
import render from "preact-render-to-string";
import type { Job } from "../../shared/types";
import { JobsDock } from "../ui/JobsDock";

const job = (status: Job["status"]): Job => ({
  id: `job-${status}`,
  drive_id: "drive-1",
  kind: "verify",
  status,
  progress: status === "done" ? 1 : 0.5,
  message: null,
  phase: null,
  eta_seconds: null,
  error: null,
  result_json: null,
  log_path: null,
  created_at: 1,
  started_at: 1,
  finished_at: status === "done" ? 2 : null,
});

describe("Recent jobs dock UX", () => {
  test("finished history starts collapsed so it cannot cover page actions", () => {
    const html = render(
      <JobsDock
        jobs={[job("done")]}
        drives={[]}
        focusDrive={() => undefined}
      />,
    );

    expect(html).toContain('class="jobdock collapsed"');
    expect(html).toContain("Recent jobs");
  });

  test("active work starts expanded so progress remains visible", () => {
    const html = render(
      <JobsDock
        jobs={[job("running")]}
        drives={[]}
        focusDrive={() => undefined}
      />,
    );

    expect(html).toContain('class="jobdock"');
    expect(html).not.toContain('class="jobdock collapsed"');
    expect(html).toContain("1 running");
  });
});
