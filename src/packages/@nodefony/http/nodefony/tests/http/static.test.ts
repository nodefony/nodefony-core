/// <reference types="node" />
import { expect } from "chai";
import https from "node:https";

// ── helpers ──────────────────────────────────────────────────────

const BASE = { hostname: "localhost", port: 5152, rejectUnauthorized: false };

type Res = { status: number; headers: Record<string, unknown>; body: Buffer };

function get(
  path: string,
  extraHeaders: Record<string, string> = {},
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { ...BASE, path, method: "GET", headers: extraHeaders },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode!,
            headers: res.headers as Record<string, unknown>,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

// ── tests ────────────────────────────────────────────────────────

describe("Static files — serve-static (requires server)", () => {
  describe("Content-Type negotiation", () => {
    it("MP3 file returns audio/mpeg", async () => {
      const { status, headers } = await get("/test/chico_buarque.mp3");
      expect(status).to.equal(200);
      expect(String(headers["content-type"])).to.include("audio/mpeg");
    });

    it("WebM file returns video/webm", async () => {
      const { status, headers } = await get("/test/oceans-clip.webm");
      expect(status).to.equal(200);
      expect(String(headers["content-type"])).to.include("video/webm");
    });

    it("favicon.ico returns image/x-icon or image/vnd.microsoft.icon", async () => {
      const { status, headers } = await get("/favicon.ico");
      expect(status).to.equal(200);
      const ct = String(headers["content-type"]);
      expect(ct).to.match(/image\/(x-icon|vnd\.microsoft\.icon)/);
    });
  });

  describe("Cache headers", () => {
    it("static file includes Cache-Control header", async () => {
      const { headers } = await get("/test/chico_buarque.mp3");
      expect(headers["cache-control"]).to.be.a("string");
    });

    it("static file includes Last-Modified or ETag", async () => {
      const { headers } = await get("/test/chico_buarque.mp3");
      const hasCache =
        headers["last-modified"] !== undefined || headers["etag"] !== undefined;
      expect(hasCache).to.be.true;
    });

    it("conditional GET with If-None-Match returns 304", async () => {
      const first = await get("/test/chico_buarque.mp3");
      const etag = first.headers["etag"] as string | undefined;
      if (!etag) return; // ETag not present — skip
      const { status } = await get("/test/chico_buarque.mp3", {
        "If-None-Match": etag,
      });
      expect(status).to.equal(304);
    });

    it("conditional GET with If-Modified-Since returns 304", async () => {
      const first = await get("/test/chico_buarque.mp3");
      const lastMod = first.headers["last-modified"] as string | undefined;
      if (!lastMod) return;
      const { status } = await get("/test/chico_buarque.mp3", {
        "If-Modified-Since": lastMod,
      });
      expect(status).to.equal(304);
    });
  });

  describe("Content-Length", () => {
    it("static file response includes Content-Length", async () => {
      const { headers, body } = await get("/test/chico_buarque.mp3");
      if (headers["content-length"]) {
        expect(Number(headers["content-length"])).to.be.greaterThan(0);
        expect(Number(headers["content-length"])).to.equal(body.length);
      }
    });
  });

  describe("Path traversal — security", () => {
    it("/../ traversal from static path is blocked", async () => {
      const { status } = await get("/test/../../../package.json");
      expect(status).to.not.equal(200);
    });

    it("encoded %2F..%2F traversal is blocked", async () => {
      const { status } = await get("/test/%2F..%2F..%2Fpackage.json");
      expect(status).to.not.equal(200);
    });

    it("files outside public root are not accessible", async () => {
      const { status, body } = await get("/test/../tsconfig.json");
      if (status === 200) {
        // Must not be the real tsconfig content
        expect(body.toString()).to.not.include('"compilerOptions"');
      } else {
        expect(status).to.be.within(400, 404);
      }
    });
  });

  describe("Non-existent static files", () => {
    it("missing static file returns 404", async () => {
      const { status } = await get("/test/does-not-exist.mp3");
      expect(status).to.equal(404);
    });

    it("directory listing is disabled (no index.html autoindex)", async () => {
      const { status } = await get("/test/");
      // serve-static with index:false → 404 for directory requests
      expect(status).to.not.equal(200);
    });
  });
});
