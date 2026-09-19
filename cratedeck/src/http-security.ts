const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const VITE_DEV_ORIGIN = "http://localhost:7743";

function loopbackHttpUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)
      ? url
      : null;
  } catch {
    return null;
  }
}

function requestOrigin(req: Request, target: URL): string | null {
  const host = req.headers.get("host");
  if (host === null) return target.origin;
  const hostUrl = loopbackHttpUrl(`${target.protocol}//${host}`);
  if (
    !hostUrl ||
    hostUrl.username !== "" ||
    hostUrl.password !== "" ||
    hostUrl.pathname !== "/" ||
    hostUrl.search !== "" ||
    hostUrl.hash !== ""
  ) {
    return null;
  }
  return hostUrl.origin;
}

/**
 * Browser mutations must originate from a loopback-served UI. Requests with
 * no Origin remain available to deckctl/MCP, whose fetch clients do not send
 * browser origin headers.
 */
export function isTrustedMutationRequest(req: Request): boolean {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return true;
  const origin = req.headers.get("origin");
  if (origin === null) return true;
  const target = loopbackHttpUrl(req.url);
  const source = loopbackHttpUrl(origin);
  if (!target || !source) return false;
  const targetOrigin = requestOrigin(req, target);
  if (targetOrigin === null) return false;
  return source.origin === targetOrigin || source.origin === VITE_DEV_ORIGIN;
}

/** Security headers shared by API, media, static, and SSE responses. */
export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Frame-Options", "DENY");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Content-Security-Policy", "frame-ancestors 'none'");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
