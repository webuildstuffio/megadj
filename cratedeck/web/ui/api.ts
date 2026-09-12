// api.ts — browser transport boundary. Toast presentation stays in toast.tsx;
// this module owns request construction, deadlines, response parsing, and the
// typed failure contract shared by every UI caller. The view installs its
// reporter below, keeping this transport leaf free of a toast-module cycle.

let reportError: ((message: string) => void) | null = null;

/** Install the UI's error presenter without coupling transport to a view. */
export function setApiErrorReporter(
  reporter: ((message: string) => void) | null,
): void {
  reportError = reporter;
}

/** fetch wrapper: JSON in, JSON out, failures surface as toasts + throw. */
export class ApiError extends Error {
  /** HTTP status, or 0 when the request never got a response. */
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T = unknown>(
  path: string,
  // Partial (not `X & {...}`) — with exactOptionalPropertyTypes the fetch
  // spread includes explicitly-undefined props (e.g. `headers: undefined`
  // for FormData posts), and plain optionals reject undefined values.
  init?: Partial<RequestInit & { quiet?: boolean; timeoutMs?: number }>,
): Promise<T> {
  // quiet = caller owns the surfacing (poll loops, probes, mapped verdicts).
  // The error still throws — quiet only suppresses the generic toast.
  // timeoutMs: abort a hung request instead of spinning forever (default
  // 30s). Long calls (prep digest ≈ the D30 sweep leg) pass their own,
  // larger budget — the deadline must EXIST and must exceed the server's
  // job duration.
  const { quiet, timeoutMs = 30_000, ...fetchInit } = init ?? {};
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(path, { ...fetchInit, signal: ctrl.signal });
  } catch (e) {
    clearTimeout(timer);
    const msg =
      (e as Error).name === "AbortError"
        ? `timed out after ${Math.round(timeoutMs / 1000)}s — server busy; retry`
        : `network error: ${(e as Error).message}`;
    if (!quiet) reportError?.(msg);
    throw new ApiError(msg, 0);
  }
  clearTimeout(timer);
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) msg = body.error;
    } catch {
      // non-JSON error body (proxy/interlock plaintext) — the status code is
      // still the message; res.ok already failed and we throw below.
    }
    if (res.status === 423) msg = `locked — ${msg}`;
    if (!quiet) reportError?.(msg);
    throw new ApiError(msg, res.status);
  }
  return res.json() as Promise<T>;
}

/** JSON POST helper — body + Content-Type in one; returns api() parsed T.
 *  Passing a FormData body skips JSON encoding entirely — the browser then
 *  sets its own multipart boundary header (a manual Content-Type would
 *  break it). */
export function apiPost<T = unknown>(
  path: string,
  body: unknown,
  init?:
    | Partial<
        Omit<RequestInit, "method" | "body" | "headers"> & {
          quiet?: boolean;
          timeoutMs?: number;
        }
      >
    | undefined,
): Promise<T> {
  // timeoutMs must be forwarded or long POSTs (dossier-style calls) inherit
  // the 30s default and abort mid-flight.
  const { quiet, timeoutMs, ...rest } = init ?? {};
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  return api<T>(path, {
    ...rest,
    method: "POST",
    ...(isForm ? {} : { headers: { "Content-Type": "application/json" } }),
    body: isForm ? body : JSON.stringify(body),
    ...(quiet === undefined ? {} : { quiet }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
}
