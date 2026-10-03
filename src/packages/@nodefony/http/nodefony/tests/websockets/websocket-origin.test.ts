/// <reference types="node" />
import { expect } from "vitest";
import WebSocket from "ws";
import { asError } from "../helpers/wsText";

// B4 — validation d'Origin au handshake WS (anti-CSWSH, OWASP WSTG-CLNT-10).
// Défaut : same-origin (Origin host == Host), loopback toléré en development,
// Origin absent (client non-navigateur) autorisé. Refus → close WS 1008.
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

  it(
    "Origin étrangère → close 1008 (CSWSH bloqué)",
    () =>
      new Promise<void>((resolve, reject) => {
        ws = new WebSocket(ROUTE, {
          ...wsOpts,
          origin: "https://evil.example.com",
        });
        ws.on("close", (code) => {
          try {
            expect(code).to.equal(1008);
            resolve();
          } catch (e) {
            reject(asError(e));
          }
        });
        // Un close abrupt peut précéder d'un 'error' selon Node — non fatal : le
        // code de fermeture (1008) reste l'assertion qui tranche.
        ws.on("error", () => undefined);
      }),
    8000,
  );

  // `domainCheck: true` (nodefony.config.ts) — le handshake passe par le même
  // contrôle de domaine que le HTTP : Host hors `trustedHosts` → 421, rendu
  // 1008 au client. Sans ce contrôle, le WebSocket était la porte dérobée de
  // la barrière Host (le HTTP rendait 421, le socket s'ouvrait).
  it(
    "Host hors trustedHosts → close 1008 (contrôle de domaine au handshake)",
    () =>
      new Promise<void>((resolve, reject) => {
        ws = new WebSocket(ROUTE, {
          ...wsOpts,
          headers: { Host: "evil.example:5152" },
        });
        // Comme le refus d'Origin : `ws` rend le 101 avant `handleWebsocket`,
        // le refus arrive en close 1008 sans que le controller ait tourné.
        ws.on("close", (code, reason) => {
          try {
            expect(code).to.equal(1008);
            expect(String(reason)).to.match(/Misdirected/);
            resolve();
          } catch (e) {
            reject(asError(e));
          }
        });
        ws.on("error", () => undefined);
      }),
    8000,
  );

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
