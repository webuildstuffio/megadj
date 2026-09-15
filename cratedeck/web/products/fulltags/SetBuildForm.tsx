// fulltags/SetBuildForm.tsx — compatibility re-export of MegasetForm.tsx.
//
// The #56 rename wave duplicated the component into MegasetForm.tsx but
// consumers still import the old name — this shim keeps them alive
// with zero drift (re-export, never a twin) until their imports flip.
// Delete when the last old-name import lands on MegasetForm.
export * from "./MegasetForm";
