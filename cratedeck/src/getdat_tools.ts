// getdat_tools.ts — the two mutating GetDat MCP tools (getdat_ingest,
// getdat_convert), extracted from mcp.ts (#47) so the MCP registry is
// pure assembly: deck twins from deriveDeckTools, archive reads from
// archive_tools, CLI-backed mutations from here. megadj's CLI stays the
// engine SSOT — both tools run it through the ONE runCliJob seam
// (cli_job_leg.ts) and return the CLI's own JSON summary.
import { loadConfig } from "./config";
import { drain } from "./jobs";
import { runCliJob } from "./cli_job_leg";
import { str, RpcParamError, obj, s, b } from "./mcp_params";
import type { ToolDef } from "./mcp_server";

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

/** The GetDat intake + conversion tools (mutating; async CLI job seam). */
export function getdatTools(): Record<string, ToolDef> {
  return {
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
        const dryRun = args["dry_run"] === true;
        return runGetDatCli(
          "ingest",
          [folder, ...(dryRun ? ["--dry-run"] : []), "--json"],
          dryRun,
        );
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
