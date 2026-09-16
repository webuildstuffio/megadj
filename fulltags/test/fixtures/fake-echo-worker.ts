// fake-echo-worker.ts — test fixture for analysis-worker.test.ts (#189).
// Announces {"type":"ready"}, then answers every NDJSON request with
// {"id", ok:true} after DELAY_MS (argv[2]). Never exits on its own —
// the kit's kill() reaps it (mirrors the real analyzers' shutdown shape).
const DELAY_MS = Number(process.argv[2] ?? "0");
let buf = "";
process.stdout.write(JSON.stringify({ type: "ready" }) + "\n");
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  buf += chunk;
  let nl: number;
  while ((nl = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    const req = JSON.parse(line) as { id: string };
    const reply = (): void =>
      process.stdout.write(JSON.stringify({ id: req.id, ok: true }) + "\n");
    if (DELAY_MS > 0) setTimeout(reply, DELAY_MS);
    else reply();
  }
});
