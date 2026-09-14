import { describe, expect, it } from "bun:test";
import {
  isTrustedMutationRequest,
  withSecurityHeaders,
} from "../src/http_security";
import { photoUpload } from "../src/drive_job_routes";
import { MAX_IMAGE_BYTES } from "../src/images";

describe("CrateDeck HTTP browser boundary", () => {
  it("rejects cross-origin browser mutations", () => {
    const req = new Request("http://127.0.0.1:7742/api/stop", {
      method: "POST",
      headers: { Origin: "https://attacker.example" },
    });
    expect(isTrustedMutationRequest(req)).toBe(false);
  });

  it("allows same-host UI mutations, including the Vite proxy port", () => {
    for (const origin of [
      "http://127.0.0.1:7742",
      "http://127.0.0.1:7743",
      "http://localhost:7743",
    ]) {
      const req = new Request("http://127.0.0.1:7742/api/drives/d1/jobs", {
        method: "POST",
        headers: { Origin: origin },
      });
      expect(isTrustedMutationRequest(req)).toBe(true);
    }
  });

  it("keeps non-browser clients working and does not gate safe methods", () => {
    expect(
      isTrustedMutationRequest(
        new Request("http://127.0.0.1:7742/api/stop", { method: "POST" }),
      ),
    ).toBe(true);
    expect(
      isTrustedMutationRequest(
        new Request("http://127.0.0.1:7742/api/status", {
          headers: { Origin: "https://attacker.example" },
        }),
      ),
    ).toBe(true);
  });

  it("rejects opaque and malformed browser origins", () => {
    for (const origin of ["null", "not a url", "file:///tmp/app.html"]) {
      const req = new Request("http://127.0.0.1:7742/api/stop", {
        method: "POST",
        headers: { Origin: origin },
      });
      expect(isTrustedMutationRequest(req)).toBe(false);
    }
  });

  it("adds anti-framing, MIME-sniffing, and referrer protections", () => {
    const response = withSecurityHeaders(new Response("ok"));
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(response.headers.get("Content-Security-Policy")).toBe(
      "frame-ancestors 'none'",
    );
  });

  it("rejects oversized multipart uploads before parsing or storing them", async () => {
    let storageTouched = false;
    const response = await photoUpload(
      new Request("http://127.0.0.1:7742/api/drives/d1/photo", {
        method: "POST",
        headers: {
          "Content-Type": "multipart/form-data; boundary=unused",
          "Content-Length": String(MAX_IMAGE_BYTES + 1),
        },
      }),
      "d1",
      {
        async choose() {
          storageTouched = true;
          return "unused";
        },
        clear() {
          storageTouched = true;
        },
      },
      (data, status = 200) => Response.json(data, { status }),
    );

    expect(response.status).toBe(413);
    expect(storageTouched).toBe(false);
  });
});
