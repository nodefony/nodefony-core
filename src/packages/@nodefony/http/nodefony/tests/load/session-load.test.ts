/// <reference types="node" />
/**
 * LOAD / limites — cycle de vie de session (plug runtime, chantier session étape 5).
 *
 * Vérité = comptage des scopes DI (`/als-test/scopes`, immunisé au bruit GC/heap)
 * — c'est le garde-fou BUG-004 (WS + session → scope leak au close). Heap = borne
 * grossière complémentaire. Exclu de la non-régression (vitest.load.config.ts).
 *
 * Serveur live requis : 5152 (HTTPS/WSS).
 */
import { expect } from "chai";
import https from "node:https";
import WebSocket from "ws";

const WSS = "wss://localhost:5152";
const wsOpts = { rejectUnauthorized: false };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function getJson(
  path: string,
  headers: Record<string, string> = {},
): Promise<{ body: any; setCookie: string[] }> {
  return new Promise((resolve, reject) => {
    const r = https.request(
      {
        hostname: "localhost",
        port: 5152,
        path,
        method: "GET",
        headers,
        rejectUnauthorized: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const setCookie = (res.headers["set-cookie"] as string[]) ?? [];
          try {
            resolve({
              body: JSON.parse(Buffer.concat(chunks).toString()),
              setCookie,
            });
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

const scopeCount = async (): Promise<number> =>
  (await getJson("/nodefony/test/als-test/scopes")).body
    .requestScopes as number;
const serverHeap = async (): Promise<number> =>
  (await getJson("/nodefony/test/memory")).body.heapUsed as number;

/** Attend que les scopes redescendent sous `target` (drain async du teardown). */
async function waitScopesBelow(target: number, tries = 30): Promise<number> {
  let n = await scopeCount();
  for (let i = 0; i < tries && n >= target; i++) {
    await sleep(100);
    n = await scopeCount();
  }
  return n;
}

function wsOpenClose(path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WSS}${path}`, wsOpts);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error("ws timeout"));
    }, 5000);
    // Ferme dès le handshake (message=null côté serveur → 1ʳᵉ frame reçue).
    ws.on("message", () => ws.close());
    ws.on("close", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

describe("Session load — scopes & heap [requires server]", () => {
  it("200 sessions HTTP (create) → scopes drainés + heap borné", async () => {
    const base = await waitScopesBelow(4);
    const heap0 = await serverHeap();
    const N = 200;
    for (let i = 0; i < N; i++) {
      const { body } = await getJson("/nodefony/test/session-rt/use");
      expect(body.hasSession).to.equal(true);
    }
    const after = await waitScopesBelow(base + 5);
    expect(after, "scopes request drainés après 200 sessions").to.be.lessThan(
      base + 5,
    );
    const heap1 = await serverHeap();
    const deltaMB = (heap1 - heap0) / (1024 * 1024);
    expect(deltaMB, `heap delta ${deltaMB.toFixed(1)} MB`).to.be.lessThan(35);
  });

  it("100 WS @UseSession open/close → scopes drainés (BUG-004)", async () => {
    const base = await waitScopesBelow(4);
    const N = 100;
    const batch = 25; // batches → évite AggregateError loopback dual-stack
    for (let b = 0; b < N; b += batch) {
      const size = Math.min(batch, N - b);
      await Promise.all(
        Array.from({ length: size }, () =>
          wsOpenClose("/nodefony/test/session-rt/ws-use"),
        ),
      );
    }
    const after = await waitScopesBelow(base + 5);
    expect(
      after,
      "scopes request drainés après 100 WS+session open/close (BUG-004)",
    ).to.be.lessThan(base + 5);
  });

  it("100 WS lazy (sans session) open/close → scopes drainés", async () => {
    const base = await waitScopesBelow(4);
    const N = 100;
    const batch = 25;
    for (let b = 0; b < N; b += batch) {
      const size = Math.min(batch, N - b);
      await Promise.all(
        Array.from({ length: size }, () =>
          wsOpenClose("/nodefony/test/session-rt/ws-lazy"),
        ),
      );
    }
    const after = await waitScopesBelow(base + 5);
    expect(after, "scopes request drainés (WS lazy)").to.be.lessThan(base + 5);
  });
});
