// shared/setbuild.ts — compatibility re-export of shared/megaset.ts.
//
// The #56 rename wave moved the set-builder wire seam to megaset.ts
// (the product's real name) but types.ts and the web products still
// import "./setbuild" — this shim keeps them alive with zero drift
// (re-export, never a twin) until their imports flip. Delete when the
// last `from "./setbuild"` lands on "./megaset".
export * from "./megaset";
