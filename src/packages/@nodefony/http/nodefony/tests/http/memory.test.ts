import { expect } from "chai";
import https from "node:https";
import WebSocket from "ws";
import "mocha";

const BASE = { hostname: "localhost", port: 5152, rejectUnauthorized: false };
const WSS = "wss://localhost:5152";
const wsOpts = { rejectUnauthorized: false };

type MemStats = { rss: number; heapTotal: number; heapUsed: number; external: number };

function get(path: string): Promise<MemStats | Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const req = https.request({ ...BASE, path, method: "GET" }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString()));
        } catch {
          resolve({});
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

async function serverHeap(): Promise<number> {
  const m = (await get("/nodefony/test/memory")) as MemStats;
  return m.heapUsed;
}

function openCloseWs(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, wsOpts);
    ws.once("open", () => ws.close());
    ws.once("close", () => resolve());
    ws.once("error", reject);
  });
}

// ── helpers ──────────────────────────────────────────────────────────────────

async function warmup(n = 20): Promise<void> {
  for (let i = 0; i < n; i++) await get("/nodefony/test/index");
}

// ── suites ───────────────────────────────────────────────────────────────────

describe("Memory leaks — HTTP (requires server)", function () {
  this.timeout(60_000);

  before(() => warmup());

  it("1000 sequential GET requests — server heap delta < 35 MB", async () => {
    const before = await serverHeap();
    for (let i = 0; i < 1000; i++) await get("/nodefony/test/index");
    const after = await serverHeap();
    expect(after - before).to.be.below(35 * 1024 * 1024, `heap grew ${((after - before) / 1024 / 1024).toFixed(1)} MB`);
  });

  it("100 consecutive sync crashes — server heap delta < 10 MB", async () => {
    const before = await serverHeap();
    for (let i = 0; i < 100; i++) await get("/nodefony/test/crash/sync");
    const after = await serverHeap();
    expect(after - before).to.be.below(10 * 1024 * 1024, `heap grew ${((after - before) / 1024 / 1024).toFixed(1)} MB`);
  });

  it("100 consecutive async crashes — server heap delta < 10 MB", async () => {
    const before = await serverHeap();
    for (let i = 0; i < 100; i++) await get("/nodefony/test/crash/async");
    const after = await serverHeap();
    expect(after - before).to.be.below(10 * 1024 * 1024, `heap grew ${((after - before) / 1024 / 1024).toFixed(1)} MB`);
  });

  it("100 consecutive native TypeError crashes — server heap delta < 15 MB", async () => {
    const before = await serverHeap();
    for (let i = 0; i < 100; i++) await get("/nodefony/test/crash/native");
    const after = await serverHeap();
    expect(after - before).to.be.below(15 * 1024 * 1024, `heap grew ${((after - before) / 1024 / 1024).toFixed(1)} MB`);
  });

  it("500 mixed requests (index + context + session) — server heap delta < 20 MB", async () => {
    const routes = [
      "/nodefony/test/index",
      "/nodefony/test/context",
      "/nodefony/test/rest/session",
    ];
    const before = await serverHeap();
    for (let i = 0; i < 500; i++) await get(routes[i % routes.length]);
    const after = await serverHeap();
    expect(after - before).to.be.below(20 * 1024 * 1024, `heap grew ${((after - before) / 1024 / 1024).toFixed(1)} MB`);
  });

  it("server is alive after load — /index returns 200", async () => {
    const req = https.request({ ...BASE, path: "/nodefony/test/index", method: "GET" });
    const status = await new Promise<number>((resolve, reject) => {
      req.on("response", (res) => { res.resume(); resolve(res.statusCode!); });
      req.on("error", reject);
      req.end();
    });
    expect(status).to.equal(200);
  });
});

describe("Memory leaks — WebSocket (requires server)", function () {
  this.timeout(60_000);

  it("100 WS connections open/close — server heap delta < 30 MB", async () => {
    const before = await serverHeap();
    for (let i = 0; i < 100; i++) {
      await openCloseWs(`${WSS}/nodefony/test/ws`);
    }
    const after = await serverHeap();
    expect(after - before).to.be.below(30 * 1024 * 1024, `heap grew ${((after - before) / 1024 / 1024).toFixed(1)} MB`);
  });

  it("50 WS echo round-trips open/send/close — heap delta < 20 MB", async () => {
    // Seuil 20 MB : chaque connexion crée une session (startSession) → allocations plus lourdes
    const before = await serverHeap();
    for (let i = 0; i < 50; i++) {
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`${WSS}/nodefony/test/ws/echo`, wsOpts);
        ws.once("open", () => ws.send("ping"));
        ws.once("message", () => ws.close());
        ws.once("close", () => resolve());
        ws.once("error", reject);
      });
    }
    const after = await serverHeap();
    expect(after - before).to.be.below(20 * 1024 * 1024, `heap grew ${((after - before) / 1024 / 1024).toFixed(1)} MB`);
  });
});
