/// <reference types="node" />
import { expect } from "vitest";
import http from "node:http";
import http2 from "node:http2";

// #767 — délai d'action intégré au pipeline + AbortSignal.
//
// /timeout/probe déclare un délai PROPRE à sa route (`responseTimeout: 250`,
// au lieu des 30 s du serveur), puis se tait. À l'échéance :
//   _onTimeout → _abortIfPending (ctx.signal annulé) → onError → 503.
// Trois choses prouvées sur un serveur RÉEL :
//   1. le délai de la ROUTE s'applique (250 ms, pas 30 s) ;
//   2. le client reçoit 503 — en HTTP/1.1 (5151) ET en HTTP/2 (5152), jamais
//      408 (RFC 9110 §15.5.9 : invite à rejouer) ni 504 (§15.6.5 : passerelle) ;
//   3. ctx.signal est annulé côté serveur (travail en vol interrompu).

const HOST = "localhost";
const PROBE = "/nodefony/test/timeout/probe";

function getH1(path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: HOST, port: 5151, path, method: "GET" },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString(),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function getH2(path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const session = http2.connect(`https://${HOST}:5152`, {
      rejectUnauthorized: false,
    });
    session.on("error", reject);
    const req = session.request({ ":method": "GET", ":path": path });
    let status = 0;
    const chunks: Buffer[] = [];
    req.on("response", (headers) => {
      status = Number(headers[":status"]);
    });
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      session.close();
      resolve({ status, body: Buffer.concat(chunks).toString() });
    });
    req.on("error", (e) => {
      session.close();
      reject(e);
    });
    req.end();
  });
}

async function probeState(): Promise<{
  signalAbortedCount: number;
  lastReason: string;
}> {
  const res = await getH1("/nodefony/test/timeout/state");
  expect(res.status).to.equal(200);
  return JSON.parse(res.body) as {
    signalAbortedCount: number;
    lastReason: string;
  };
}

describe("Délai d'action → 503 + AbortSignal, délai propre à la route (#767, serveur requis)", () => {
  beforeEach(async () => {
    await getH1("/nodefony/test/timeout/reset");
  });

  for (const [label, get] of [
    ["HTTP/1.1 (5151)", getH1],
    ["HTTP/2 (5152)", getH2],
  ] as const) {
    it(`${label} : 503 au délai de la ROUTE, et ctx.signal annulé`, async () => {
      const t0 = performance.now();
      const res = await get(PROBE);
      const elapsed = performance.now() - t0;
      expect(res.status).to.equal(503);
      // Le délai de la route (250 ms) a joué, pas celui du serveur (30 s).
      // Borne large : seul l'ordre de grandeur compte.
      expect(elapsed).to.be.below(10_000);

      const state = await probeState();
      expect(state.signalAbortedCount).to.equal(1);
      expect(state.lastReason).to.match(/timeout/i);
    });
  }

  it("le serveur reste sain après un délai d'action", async () => {
    const health = await getH1("/nodefony/test/index");
    expect(health.status).to.equal(200);
  });
});
