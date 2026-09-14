import { VERIFY_HELP } from "./verify_help";
import { KIND_DOCS, printKindDoc } from "./deckctl_docs";
import { JSON_MODE, emitJson, errOut, log } from "./deckctl_runtime";

export async function cmdExplain(
  kind?: string,
  knownKinds = Object.keys(KIND_DOCS).join(", "),
): Promise<void> {
  const showVerify = !kind || kind === "verify";
  if (showVerify) {
    if (JSON_MODE && kind === "verify") {
      await emitJson({ verify: VERIFY_HELP });
      return;
    }
    log("── verify ──");
    log(VERIFY_HELP.intro);
    log("");
    log("checks:");
    for (const check of VERIFY_HELP.checks) {
      log(`  • ${check.label} — ${check.what}`);
      log(`      why: ${check.why}`);
      log(`      if it fails: ${check.if_fail}`);
      log(`      fix: ${check.fix}`);
    }
    log("");
    log(`typical time: ${VERIFY_HELP.duration}`);
    log(`safety: ${VERIFY_HELP.safety}`);
    log("");
    if (kind === "verify") return;
  }
  if (JSON_MODE) {
    await emitJson(KIND_DOCS);
    return;
  }
  if (!kind) {
    for (const [name, doc] of Object.entries(KIND_DOCS))
      printKindDoc(name, doc, log);
    return;
  }
  const doc = KIND_DOCS[kind];
  if (!doc) {
    await errOut(`unknown kind "${kind}" — one of: verify, ${knownKinds}`);
    process.exit(2);
  }
  printKindDoc(kind, doc, log);
}
