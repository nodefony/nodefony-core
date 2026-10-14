/// <reference types="node" />
import { expect } from "vitest";
import https from "node:https";
import WebSocket from "ws";
import { expectHandshakeRefused } from "../helpers/wsHandshake";

// P2.4 — controller `initialize()` error boundary.
//
// LifecycleController.initialize() always throws. This proves the crash is
// caught by the pipeline (Resolver.newController → await initialize() →
// HttpContext.handle reject → HttpKernel.onError) and rendered as a coherent
// 500 JSON error, WITHOUT hanging the request or killing the server.

const BASE = { hostname: "localhost", port: 5152, rejectUnauthorized: false };

function getJson(path: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = https.request({ ...BASE, path, method: "GET" }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString();
        try {
          resolve({ status: res.statusCode!, body: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode!, body: raw });
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

describe("Controller initialize() error boundary — P2.4 (requires server)", () => {
  it("a throwing initialize() yields a coherent 500 JSON error, not a hang", async () => {
    const res = await getJson("/nodefony/test/lifecycle/init-crash");
    expect(res.status).to.equal(500);
    expect(res.body).to.be.an("object");
    expect(res.body.code).to.equal(500);
    expect(res.body.message).to.be.a("string").that.is.not.empty;
    // The normalised error payload + nodefony envelope are present.
    expect(res.body.error).to.be.an("object");
    expect(res.body.nodefony).to.be.an("object");
    expect(res.body.nodefony.requestId).to.be.a("string").that.is.not.empty;
  });

  it("the server stays healthy after the initialize() crash", async () => {
    const health = await getJson("/nodefony/test/index");
    expect(health.status).to.equal(200);
  });

  /**
   * Même sonde, transport WebSocket — où l'ORDRE diffère : le controller y est
   * instancié AU HANDSHAKE, avant `context.connect()` (il porte le protocole
   * négocié et c'est la dernière fenêtre pour toucher la réponse). Un
   * `initialize()` qui lève ne peut donc pas se rendre en « 500 » : le contrat
   * observable est une FERMETURE, jamais une socket muette ni un handshake qui
   * pend. Ce que le client doit voir : close **1011** (Internal Error,
   * RFC 6455 §7.4.1).
   */
  it("in WebSocket, a throwing initialize() is refused 500 at the handshake — never opens, never hangs", async () => {
    // #596 : le contrôleur WS est instancié AVANT l'acceptation ; son échec
    // est un refus du handshake (500, RFC 6455 §4.2.2), pas une ouverture
    // suivie d'un close 1011.
    const refused = await expectHandshakeRefused(
      "wss://localhost:5152/nodefony/test/lifecycle/init-crash-ws",
      { timeoutMs: 8000 },
    );
    expect(refused.status, "erreur interne au handshake").to.equal(500);
  });
});
