// set/SetPage.tsx — compatibility re-export of megaset/SetPage.tsx.
//
// The #56 rename wave moved the canvas file to products/megaset/ but
// App.tsx still routes #/set to products/set/SetPage — this shim keeps
// the route alive with zero drift (re-export, never a twin) until the
// router import flips. Delete when App.tsx lands on the megaset path.
export * from "../megaset/SetPage";
