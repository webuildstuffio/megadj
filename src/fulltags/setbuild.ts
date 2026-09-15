// fulltags/setbuild.ts — compatibility re-export of megaset.ts.
//
// The #56 rename wave moved the CLI spoke to megaset.ts but
// cli-commands-analysis.ts still derives from "./fulltags/setbuild" —
// this shim keeps the derivation alive with zero drift (re-export,
// never a twin) until the import flips. Delete when the last
// `from "./fulltags/setbuild"` lands on "./fulltags/megaset".
export * from "./megaset";
