// cratedeck/src/setbuild.ts — compatibility re-export of megaset.ts.
//
// The #56 rename wave moved the set-builder engine to megaset.ts but
// megaset.test.ts and the `megadj setbuild` CLI spoke still import
// "../src/setbuild" — this shim keeps them alive with zero drift
// (re-export, never a twin) until their imports flip. Delete when the
// last `from ".../setbuild"` lands on ".../megaset".
export * from "./megaset";
