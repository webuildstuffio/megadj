// fulltags/SetBuilderResult.tsx — compatibility re-export of MegasetResult.tsx.
//
// The #56 rename wave duplicated the component into MegasetResult.tsx but
// consumers (SetPage, the similar-ux DOM tests) still import the old
// name — this shim keeps them alive with zero drift (re-export, never
// a twin) until their imports flip. Delete when the last old-name
// import lands on MegasetResult.
export * from "./MegasetResult";
