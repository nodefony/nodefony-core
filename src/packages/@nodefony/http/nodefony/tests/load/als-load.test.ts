/// <reference types="node" />
/**
 * LOAD / STRESS tests for the ALS fix + WS lifecycle (BUG-001/002/003).
 *
 * Excluded from the default non-regression run (heavy network loops) — run via
 * `.mocharc.load.json`. Keep functional assertions in tests/integration/.
 *
 * Live server: wss://localhost:5152 + 127.0.0.1:5152 (HTTPS).
 */
import { expect } from "chai";
import https from "node:https";
import WebSocket from "ws";
import "mocha";

const WSS = "wss://localhost:5152";
const wsOpts = { rejectUnauthorized: false };

function getJson(path: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const r = https.request(
      { hostname: "localhost", port: 5152, path, method: "GET", rejectUnauthorized: false },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString()));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    r.on("error", reject);
    r.end();
  });
}

const serverHeap = async () => (await getJson("/nodefony/test/memory")).heapUsed as number;
const scopes = async () => (await getJson("/nodefony/test/als-test/scopes")).requestScopes as number;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function wsExchange(path: string, messages: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WSS}${path}`, wsOpts);
    let sent = 0;
    ws.on("message", () => {
      if (sent < messages.length) ws.send(messages[sent++]);
      else ws.close();
    });
    ws.once("close", () => resolve());
    ws.once("error", reject);
  });
}

function wsBadClose(path: string): Promise<void> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${WSS}${path}`, wsOpts);
    let done = false;
    const fin = () => { if (!done) { done = true; resolve(); } };
    ws.on("open", () => setTimeout(() => { try { ws.close(); } catch { /* ignore */ } fin(); }, 3));
    ws.on("close", fin);
    ws.on("unexpected-response", fin);
    ws.on("error", fin);
    setTimeout(fin, 400);
  });
}

describe("LOAD — ALS WebSocket lifecycle", function () {
  this.timeout(120_000);

  it("BUG-001 — 100 connections x 10 messages: heap delta < 25 MB", async () => {
    const before = await serverHeap();
    const batch = Array.from({ length: 10 }, (_, i) => `msg-${i}`);
    for (let i = 0; i < 100; i++) await wsExchange("/nodefony/test/als-test/ws", batch);
    const after = await serverHeap();
    const deltaMb = (after - before) / 1024 / 1024;
    expect(after - before).to.be.below(
      25 * 1024 * 1024,
      `heap grew ${deltaMb.toFixed(1)} MB — AsyncResource.bind must not leak`,
    );
  });

  it("lifecycle — 150 WS connections open/msg/close: heap delta < 20 MB + scopes clean", async () => {
    const heapBefore = await serverHeap();
    const scopesBefore = await scopes();
    for (let i = 0; i < 150; i++) await wsExchange("/nodefony/test/als-test/ws/after", ["x"]);
    await wait(200);
    const after = await serverHeap();
    const deltaMb = (after - heapBefore) / 1024 / 1024;
    expect(after - heapBefore).to.be.below(
      20 * 1024 * 1024,
      `heap grew ${deltaMb.toFixed(1)} MB — clean()/leaveScope must run on every close`,
    );
    // Delta, not absolute: ambient scopes may be non-zero from prior suites
    // (e.g. the pre-existing WS-session leak, BUG-004). 150 leaks would show here.
    expect((await scopes()) - scopesBefore, "no leaked request scopes").to.be.below(5);
  });

  it("BUG-003 — 500 WS errors (404 + 1002) leak zero request scopes", async () => {
    const before = await scopes();
    for (let i = 0; i < 250; i++) await wsBadClose("/nodefony/test/als-test/nope");
    for (let i = 0; i < 250; i++) await wsBadClose("/nodefony/test/ws/echo/proto");
    await wait(200);
    expect((await scopes()) - before, "error path must release every scope").to.be.below(5);
  });

  it("BUG-004 — 300 session-bearing WS closed at handshake leak zero scope", async () => {
    const before = await scopes();
    for (let i = 0; i < 300; i++) {
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`${WSS}/nodefony/test/ws`, wsOpts);
        ws.once("open", () => ws.close());
        ws.once("close", () => resolve());
        ws.once("error", reject);
      });
    }
    await wait(300);
    expect((await scopes()) - before, "session WS teardown must release every scope").to.be.below(5);
  });
});
