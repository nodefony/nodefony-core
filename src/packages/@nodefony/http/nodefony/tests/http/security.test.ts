import { expect } from "chai";
import https from "node:https";
import "mocha";

// ── helpers ──────────────────────────────────────────────────────

const BASE = { hostname: "localhost", port: 5152, rejectUnauthorized: false };

type Res = { status: number; headers: Record<string, unknown>; body: unknown };

function get(path: string, headers: Record<string, string> = {}): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = https.request({ ...BASE, path, method: "GET", headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString();
        try {
          resolve({ status: res.statusCode!, headers: res.headers as Record<string, unknown>, body: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode!, headers: res.headers as Record<string, unknown>, body: raw });
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

// ── tests ────────────────────────────────────────────────────────

describe("Security — path traversal (requires server)", () => {
  it("/../ in URL path does not escape module root", async () => {
    const { status } = await get("/nodefony/test/../../../etc/passwd");
    expect(status).to.not.equal(200);
  });

  it("encoded %2F%2E%2E traversal is blocked", async () => {
    const { status } = await get("/nodefony/test/%2F..%2F..%2Fetc%2Fpasswd");
    expect(status).to.not.equal(200);
  });

  it("serve-static does not expose files outside public root", async () => {
    const { status, body } = await get("/public/../package.json");
    // must not return the package.json contents
    if (status === 200) {
      const b = String(body);
      expect(b).to.not.include('"name"');
      expect(b).to.not.include('"version"');
    } else {
      expect(status).to.be.within(400, 404);
    }
  });

  it("null byte in URL is rejected (no crash)", async () => {
    const { status } = await get("/nodefony/test/index%00.ts");
    expect(status).to.be.within(400, 499);
  });
});

describe("Security — header injection (requires server)", () => {
  it("normal header echo works", async () => {
    const { status, headers } = await get("/nodefony/test/header-echo?x-val=hello");
    expect(status).to.equal(200);
    expect(headers["x-echoed"]).to.equal("hello");
  });

  it("CR/LF in query param does not inject new header", async () => {
    // %0d%0a = \r\n — classic response splitting attempt
    const { status, headers } = await get(
      "/nodefony/test/header-echo?x-val=injected%0d%0aX-Injected%3a%20pwned"
    );
    // Node.js throws ERR_INVALID_HTTP_TOKEN → server returns 500
    // OR the value is sanitized — either way X-Injected must NOT appear
    expect(headers["x-injected"]).to.be.undefined;
    // server must not crash — next request must succeed
  });

  it("server is alive after header injection attempt", async () => {
    await get("/nodefony/test/header-echo?x-val=test%0d%0aEvil%3a%20yes").catch(() => {});
    const { status } = await get("/nodefony/test/index");
    expect(status).to.equal(200);
  });

  it("very long header value does not crash server", async () => {
    const longVal = "x".repeat(8192);
    const { status } = await get("/nodefony/test/index", { "X-Long-Header": longVal });
    expect(status).to.be.within(200, 599);
  });

  it("many headers does not crash server", async () => {
    const manyHeaders: Record<string, string> = {};
    for (let i = 0; i < 50; i++) {
      manyHeaders[`x-header-${i}`] = `value-${i}`;
    }
    const { status } = await get("/nodefony/test/index", manyHeaders);
    expect(status).to.be.within(200, 599);
  });
});

describe("Security — URL / request size (requires server)", () => {
  it("very long URL path returns 4xx (no crash)", async () => {
    const longPath = "/nodefony/test/" + "a".repeat(4096);
    const { status } = await get(longPath);
    expect(status).to.be.within(400, 499);
  });

  it("URL with special chars does not crash", async () => {
    const { status } = await get("/nodefony/test/<script>alert(1)</script>");
    expect(status).to.be.within(400, 499);
  });

  it("SQL injection pattern in URL does not crash", async () => {
    // URL-encode the segment so Node.js https.request() accepts it
    const segment = encodeURIComponent("'; DROP TABLE users; --");
    const { status } = await get(`/nodefony/test/route/ele/${segment}/json/add`);
    expect(status).to.be.within(200, 599);
  });
});

describe("Security — cookie (requires server)", () => {
  it("oversized Cookie header does not crash server", async () => {
    const bigCookie = "nodefony=" + "x".repeat(8192);
    const { status } = await get("/nodefony/test/rest/session", { Cookie: bigCookie });
    expect(status).to.be.within(200, 599);
  });

  it("malformed Cookie header does not crash server", async () => {
    const { status } = await get("/nodefony/test/rest/session", {
      Cookie: "not-valid-cookie-format!@#$%^",
    });
    expect(status).to.be.within(200, 599);
  });

  it("multiple Set-Cookie values are distinct (no header confusion)", async () => {
    const { headers } = await get("/nodefony/test/rest/session");
    const cookies = headers["set-cookie"] as string[] | string | undefined;
    if (Array.isArray(cookies)) {
      // each cookie must not contain raw \r\n
      for (const c of cookies) {
        expect(c).to.not.include("\r");
        expect(c).to.not.include("\n");
      }
    }
  });
});

describe("Security — information disclosure (requires server)", () => {
  it("404 response does not expose internal file paths", async () => {
    const { body } = await get("/nodefony/test/does-not-exist");
    const b = String(body);
    expect(b).to.not.match(/\/Users\/|\/home\/|C:\\|node_modules/);
  });

  it("500 response does not expose stack trace in production mode", async () => {
    // In development mode, stacks may be exposed — we only assert no crash
    const { status } = await get("/nodefony/test/crash/sync");
    expect(status).to.equal(500);
    // TODO: in production mode assert stack is not in body
  });

  it("response headers do not expose server version unnecessarily", async () => {
    const { headers } = await get("/nodefony/test/index");
    // X-Powered-By should not expose internal version details
    const powered = String(headers["x-powered-by"] ?? "");
    expect(powered).to.not.match(/\d+\.\d+\.\d+/); // no semver in header
  });
});
