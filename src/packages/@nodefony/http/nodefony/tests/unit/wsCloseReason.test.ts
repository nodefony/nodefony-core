/// <reference types="node" />
import { describe, it, expect, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import Ws, { WebSocketServer } from "ws";
import WebsocketResponse from "../../src/context/websocket/Response";
import type WebsocketContext from "../../src/context/websocket/WebsocketContext";
import {
  toWsCloseReason,
  MAX_WS_CLOSE_REASON_BYTES,
} from "../../src/context/websocket/wsCloseReason";

/**
 * `ws.close(code, reason)` LÈVE au-delà de 123 octets de raison et ne ferme
 * PAS la connexion (8.21 : bloquée en CLOSING, hors d'atteinte du heartbeat ;
 * 8.22 : reste OPEN). La raison porte souvent un message d'erreur de
 * controller, de longueur libre → connexion jamais fermée.
 */

const bytes = (s: string): number => Buffer.byteLength(s, "utf8");

describe("toWsCloseReason — borne RFC 6455 §5.5", () => {
  it("laisse intacte une raison qui tient", () => {
    expect(toWsCloseReason("Rejected")).toBe("Rejected");
    const exact = "a".repeat(MAX_WS_CLOSE_REASON_BYTES);
    expect(toWsCloseReason(exact)).toBe(exact);
    // 41 caractères de 3 octets = 123 octets pile : conservé
    const cjk = "字".repeat(41);
    expect(toWsCloseReason(cjk)).toBe(cjk);
  });

  it("tronque une raison ASCII trop longue, terminée par …", () => {
    const out = toWsCloseReason("x".repeat(500));
    expect(bytes(out)).toBeLessThanOrEqual(MAX_WS_CLOSE_REASON_BYTES);
    expect(out.endsWith("…")).toBe(true);
    expect(out.startsWith("x".repeat(100))).toBe(true);
  });

  it("ne coupe jamais un caractère multi-octets ni une paire de substitution", () => {
    for (const unit of ["é", "字", "😀"]) {
      const out = toWsCloseReason(unit.repeat(200));
      expect(bytes(out), unit).toBeLessThanOrEqual(MAX_WS_CLOSE_REASON_BYTES);
      // UTF-8 valide : l'aller-retour ne produit aucun caractère de remplacement
      expect(Buffer.from(out, "utf8").toString("utf8"), unit).toBe(out);
      expect(out.includes("�"), unit).toBe(false);
      expect(out.slice(0, -1).split(unit).join(""), unit).toBe("");
    }
  });

  it("rend une chaîne vide pour une raison absente", () => {
    expect(toWsCloseReason(undefined)).toBe("");
    expect(toWsCloseReason(null)).toBe("");
  });
});

describe("WS Response.close — raison longue sur une vraie connexion", () => {
  let wss: WebSocketServer | null = null;
  afterEach(async () => {
    await new Promise<void>((resolve) => {
      if (!wss) return resolve();
      for (const c of wss.clients) c.terminate();
      wss.close(() => resolve());
    });
    wss = null;
  });

  it("ferme réellement la connexion avec une raison de 300 octets", async () => {
    const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    wss = server;
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    const context = {
      container: { get: () => ({ log: () => undefined }) },
      server: null,
    } as unknown as WebsocketContext;
    wss.on("connection", (socket) => {
      new WebsocketResponse(socket, context).close(1011, "e".repeat(300));
    });

    const client = new Ws(`ws://127.0.0.1:${port}`);
    const closed = await new Promise<{ code: number; reason: string }>(
      (resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("connexion jamais fermée")),
          2000,
        );
        client.on("close", (code, reason) => {
          clearTimeout(timer);
          resolve({ code, reason: reason.toString("utf8") });
        });
      },
    );
    expect(closed.code).toBe(1011);
    expect(bytes(closed.reason)).toBeLessThanOrEqual(MAX_WS_CLOSE_REASON_BYTES);
    expect(closed.reason.endsWith("…")).toBe(true);
  });
});
