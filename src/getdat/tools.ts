// getdat_tools.ts — the two mutating GetDat MCP tools (getdat_ingest,
// getdat_convert), extracted from mcp.ts (#47) so the MCP registry is
// pure assembly: deck twins from deriveDeckTools, archive reads from
// archive_tools, CLI-backed mutations from here. megadj's CLI stays the
// engine SSOT — both tools run it through the ONE runCliJob seam
// (cli_job_leg.ts) and return the CLI's own JSON summary.
import { loadConfig } from "../deck/config";
import { drain } from "../deck/jobs/engine";
import { runCliJob } from "../deck/jobs/cli-job-leg";
import { str, RpcParamError, obj, s, b } from "../deck/mcp/params";
import type { ToolDef } from "../deck/mcp/server";

/** Run a GetDat CLI command through the same async spawn/drain/summary seam
 * used by the server's long-running CLI job legs. MCP stdout is reserved for
 * JSON-RPC, so child logs go to stderr. */
async function runGetDatCli(
  command: "ingest" | "convert",
  argv: string[],
  dryRun: boolean,
): Promise<Record<string, unknown>> {
  const cfg = loadConfig(`${import.meta.dir}/..`);
  const handle: { cancelled: boolean; proc?: Bun.Subprocess } = {
    cancelled: false,
  };
  return runCliJob(
    {
      cfg,
      jobTimeoutMin: cfg.jobTimeoutMin,
      cancelled: () => handle.cancelled,
      killProc: (proc) => proc.kill(),
      log: (line) => console.error(`[getdat:${command}] ${line}`),
      tick: () => undefined,
      drain,
      drainText: async (stream) => (stream ? new Response(stream).text() : ""),
    },
    { command, label: `megadj ${command}`, argv },
    !dryRun,
    handle,
  );
}

/** Shared ingest invocation (#316: getdat_intake action=process and
 *  getdat_ingest were byte-twin run bodies). */
function runIngest(
  folder: string,
  dryRun: boolean,
): Promise<Record<string, unknown>> {
  return runGetDatCli(
    "ingest",
    [folder, ...(dryRun ? ["--dry-run"] : []), "--json"],
    dryRun,
  );
}

/** The GetDat intake + conversion tools (mutating; async CLI job seam). */
export function getdatTools(deps?: {
  /** dump census reader (#20) — injected by mcp.ts assembly so the MCP
   *  twin answers "what dumps are pending?" without shelling out */
  dumpCensus?: (() => unknown) | undefined;
}): Record<string, ToolDef> {
  return {
    getdat_intake: {
      description:
        "GetDat intake ledger (#20): census of ingest dumps — one unit per dated batch folder, each with status (done | partial), ingested/duplicates/pending counts, and its last error. Bare call = the census. action=process runs megadj ingest <folder> --json through the async CLI job seam (folder required). Re-ingesting a dump resumes its pending tail instead of re-downloading.",
      destructive: true,
      inputSchema: obj(
        {
          action: s('omit for the census, or "process"'),
          folder: s("source folder (required when action=process)"),
          dry_run: b("process without writing (default false)"),
        },
        [],
      ),
      run: async (args) => {
        const action = str(args, "action");
        if (!action || action === "census") {
          if (deps?.dumpCensus) return deps.dumpCensus();
          throw new RpcParamError("dump census unavailable on this server");
        }
        if (action === "process") {
          const folder = str(args, "folder")?.trim();
          if (!folder) throw new RpcParamError("folder is required");
          return runIngest(folder, args["dry_run"] === true);
        }
        throw new RpcParamError(`unknown action "${action}"`);
      },
    },

    getdat_ingest: {
      description:
        "GetDat intake (mutating): runs megadj ingest <folder> --json through the async CLI job seam and returns the CLI's own summary, including tagged, artwork, dedupe, conversion, and compatibility counts. dry_run defaults false. The call is bounded by the configured job timeout.",
      destructive: true,
      inputSchema: obj(
        {
          folder: s("source folder to ingest"),
          dry_run: b(
            "report what would change without writing (default false)",
          ),
        },
        ["folder"],
      ),
      run: async (args) => {
        const folder = str(args, "folder")?.trim();
        if (!folder) throw new RpcParamError("folder is required");
        return runIngest(folder, args["dry_run"] === true);
      },
    },

    getdat_convert: {
      description:
        "GetDat archive conversion (mutating): runs megadj convert --json through the async CLI job seam and returns converted/total, artwork counts, warnings, and per-file failures. dry_run and no_artwork default false. The full-archive call is bounded by the configured job timeout.",
      destructive: true,
      inputSchema: obj({
        dry_run: b("report what would change without writing (default false)"),
        no_artwork: b("skip the artwork lookup ladder (default false)"),
      }),
      run: async (args) => {
        const dryRun = args["dry_run"] === true;
        const noArtwork = args["no_artwork"] === true;
        return runGetDatCli(
          "convert",
          [
            ...(dryRun ? ["--dry-run"] : []),
            ...(noArtwork ? ["--no-artwork"] : []),
            "--json",
          ],
          dryRun,
        );
      },
    },
  };
}
