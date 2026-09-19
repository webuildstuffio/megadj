/**
 * error-text.ts — the `unknown → message` seam name for src/ (issue #82).
 *
 * The IMPLEMENTATION lives in src/shared/leaf/fmt.ts (`errMessage`) —
 * cratedeck/shared is the dependency leaf, so src/, fulltags/, and web
 * all reach the same body. This module keeps the `errorText` name that
 * src/-tier callers already import.
 */
export { errMessage as errorText } from "./leaf/fmt";
