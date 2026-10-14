/// <reference types="node" />
import { expect } from "vitest";
import WebSocket from "ws";
import { expectHandshakeRefused } from "../helpers/wsHandshake";

// B4 — validation d'Origin au handshake WS (anti-CSWSH, OWASP WSTG-CLNT-10).
// Défaut : same-origin (Origin host == Host), loopback toléré en development,
// Origin absent (client non-navigateur) autorisé. Refus → 403 AU HANDSHAKE,
// avant le 101 (#596) — jamais une ouverture suivie d'un close 1008.
// Requiert le serveur dev (port 5152, wss).

const WSS = "wss://localhost:5152";
const wsOpts = { rejectUnauthorized: false };
const ROUTE = `${WSS}/nodefony/test/ws`;

describe("WEBSOCKET ORIGIN — anti-CSWSH (B4, requires server)", () => {
  let ws: WebSocket | null = null;

  afterEach(() => {
    if (ws && ws.readyState !== WebSocket.CLOSED) {
      ws.terminate();
    }
    ws = null;
  });

  it("Origin étrangère → 403 au handshake (CSWSH bloqué, jamais d'ouverture)", async () => {
    const refused = await expectHandshakeRefused(ROUTE, {
      origin: "https://evil.example.com",
    });
    expect(refused.status).to.equal(403);
  });

  // `domainCheck: true` (nodefony.config.ts) — le handshake passe par le même
  // contrôle de domaine que le HTTP : Host hors `trustedHosts` → 421 (RFC 9110
  // §15.5.20), désormais rendu tel quel AU HANDSHAKE. Sans ce contrôle, le
  // WebSocket était la porte dérobée de la barrière Host.
  it("Host hors trustedHosts → 421 au handshake (contrôle de domaine)", async () => {
    const refused = await expectHandshakeRefused(ROUTE, {
      headers: { Host: "evil.example:5152" },
    });
    expect(refused.status).to.equal(421);
    expect(refused.statusMessage).to.match(/Misdirected/);
  });

  it(
    "Same-origin (Origin == Host) → connexion acceptée",
    () =>
      new Promise<void>((resolve, reject) => {
        ws = new WebSocket(ROUTE, { ...wsOpts, origin: WSS });
        ws.on("open", () => {
          expect(ws?.readyState).to.equal(WebSocket.OPEN);
          ws?.close();
          resolve();
        });
        ws.on("error", (e) => reject(e));
      }),
    8000,
  );

  it(
    "Sans Origin (client non-navigateur) → connexion acceptée",
    () =>
      new Promise<void>((resolve, reject) => {
        ws = new WebSocket(ROUTE, wsOpts);
        ws.on("open", () => {
          expect(ws?.readyState).to.equal(WebSocket.OPEN);
          ws?.close();
          resolve();
        });
        ws.on("error", (e) => reject(e));
      }),
    8000,
  );
});
