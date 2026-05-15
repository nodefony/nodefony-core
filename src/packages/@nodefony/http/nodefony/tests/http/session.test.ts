import { expect } from "chai";
import https from "node:https";
import "mocha";

// ── helpers ──────────────────────────────────────────────────────

const BASE = { hostname: "localhost", port: 5152, rejectUnauthorized: false };

function request(
  path: string,
  method: string = "GET",
  headers: Record<string, string> = {}
): Promise<{ status: number; body: unknown; setCookie: string[] }> {
  return new Promise((resolve, reject) => {
    const req = https.request({ ...BASE, path, method, headers }, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        try {
          resolve({
            status: res.statusCode!,
            body: JSON.parse(raw),
            setCookie: (res.headers["set-cookie"] as string[]) ?? [],
          });
        } catch {
          resolve({ status: res.statusCode!, body: raw, setCookie: [] });
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

function extractSessionCookie(setCookie: string[]): string | null {
  const entry = setCookie.find((c) => c.startsWith("nodefony="));
  return entry ? entry.split(";")[0] : null;
}

// ── tests ────────────────────────────────────────────────────────

describe("Session — integration (requires server)", () => {
  let cookie: string;
  let sessionId: string;

  describe("Session lifecycle", () => {
    it("GET /session creates a new session and returns Set-Cookie", async () => {
      const { status, body, setCookie } = await request("/nodefony/test/rest/session");
      expect(status).to.equal(200);
      const raw = body as Record<string, unknown>;
      expect(raw).to.have.property("id").that.is.a("string").with.length.greaterThan(0);
      expect(raw.status).to.equal("active");
      const c = extractSessionCookie(setCookie);
      expect(c).to.be.a("string");
      cookie = c!;
      sessionId = raw.id as string;
    });

    it("second request with cookie reuses the same session id", async () => {
      const { status, body } = await request("/nodefony/test/rest/session", "GET", {
        Cookie: cookie,
      });
      expect(status).to.equal(200);
      expect((body as Record<string, unknown>).id).to.equal(sessionId);
    });
  });

  describe("Session attributes (set / get)", () => {
    it("sets an attribute in the session", async () => {
      const { status, body } = await request(
        "/nodefony/test/rest/session/set/username/alice",
        "GET",
        { Cookie: cookie }
      );
      expect(status).to.equal(200);
      const raw = body as Record<string, unknown>;
      expect(raw.key).to.equal("username");
      expect(raw.value).to.equal("alice");
    });

    it("gets the attribute back on next request", async () => {
      const { status, body } = await request(
        "/nodefony/test/rest/session/get/username",
        "GET",
        { Cookie: cookie }
      );
      expect(status).to.equal(200);
      expect((body as Record<string, unknown>).value).to.equal("alice");
    });

    it("returns null for an attribute never set", async () => {
      const { status, body } = await request(
        "/nodefony/test/rest/session/get/nope",
        "GET",
        { Cookie: cookie }
      );
      expect(status).to.equal(200);
      expect((body as Record<string, unknown>).value).to.be.null;
    });
  });

  describe("FlashBag", () => {
    it("sets a flashBag entry", async () => {
      const { status, body } = await request(
        "/nodefony/test/rest/session/flash/notice/saved",
        "GET",
        { Cookie: cookie }
      );
      expect(status).to.equal(200);
      expect((body as Record<string, unknown>).value).to.equal("saved");
    });

    it("reads the flashBag entry (consumed once)", async () => {
      const { status, body } = await request(
        "/nodefony/test/rest/session/flash/notice",
        "GET",
        { Cookie: cookie }
      );
      expect(status).to.equal(200);
      expect((body as Record<string, unknown>).value).to.equal("saved");
    });

    it("flashBag is gone after first read", async () => {
      const { status, body } = await request(
        "/nodefony/test/rest/session/flash/notice",
        "GET",
        { Cookie: cookie }
      );
      expect(status).to.equal(200);
      expect((body as Record<string, unknown>).value).to.be.null;
    });
  });

  describe("Session without cookie", () => {
    it("creates a fresh session when no cookie is sent", async () => {
      const { status, body } = await request("/nodefony/test/rest/session");
      expect(status).to.equal(200);
      const id = (body as Record<string, unknown>).id as string;
      expect(id).to.be.a("string");
      expect(id).to.not.equal(sessionId);
    });
  });

  describe("Session destroy", () => {
    it("DELETE /session destroys the session", async () => {
      const { status, body } = await request(
        "/nodefony/test/rest/session",
        "DELETE",
        { Cookie: cookie }
      );
      expect(status).to.equal(200);
      expect((body as Record<string, unknown>).destroyed).to.equal(sessionId);
    });
  });
});

describe("Context — integration (requires server)", () => {
  it("GET /context returns type, scheme, method, host", async () => {
    const { status, body } = await request("/nodefony/test/context");
    expect(status).to.equal(200);
    const ctx = body as Record<string, unknown>;
    expect(ctx.type).to.be.a("string");
    expect(ctx.scheme).to.be.a("string");
    expect(ctx.method).to.equal("GET");
    expect(ctx.host).to.be.a("string");
  });

  it("scheme is 'https' for HTTPS requests", async () => {
    const { body } = await request("/nodefony/test/context");
    expect((body as Record<string, unknown>).scheme).to.equal("https");
  });

  it("remoteAddress is populated", async () => {
    const { body } = await request("/nodefony/test/context");
    const addr = (body as Record<string, unknown>).remoteAddress;
    expect(addr).to.be.a("string").with.length.greaterThan(0);
  });

  it("sessionId is set (DefaultController.initialize starts session)", async () => {
    const { body } = await request("/nodefony/test/context");
    expect((body as Record<string, unknown>).sessionId).to.be.a("string");
  });
});

describe("HttpKernel resilience (requires server)", () => {
  it("sync throw in controller returns 500, not crash", async () => {
    const { status } = await request("/nodefony/test/crash/sync");
    expect(status).to.equal(500);
  });

  it("async rejection in controller returns 500, not crash", async () => {
    const { status } = await request("/nodefony/test/crash/async");
    expect(status).to.equal(500);
  });

  it("native TypeError in controller returns 500, not crash", async () => {
    const { status } = await request("/nodefony/test/crash/native");
    expect(status).to.equal(500);
  });

  it("server is still alive after crashes — next request succeeds", async () => {
    const { status } = await request("/nodefony/test/rest/session");
    expect(status).to.equal(200);
  });

  it("404 on unknown route — no crash", async () => {
    const { status } = await request("/nodefony/test/this/does/not/exist");
    expect(status).to.equal(404);
  });

  it("wrong HTTP method returns 4xx — no crash", async () => {
    const { status } = await request("/nodefony/test/rest", "DELETE");
    expect(status).to.be.within(400, 499);
  });
});
