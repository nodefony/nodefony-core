/// <reference types="node" />
/**
 * #571 — l'identité ne survit pas à son unité de travail dans l'ALS.
 *
 * Un minuteur armé PENDANT la requête (ou la connexion WebSocket) garde le
 * magasin `RequestContext` au-delà de la réponse. Le pare-feu y a posé
 * `user`, `userId` et `token` : sans le vidage au nettoyage du contexte, un
 * travail détaché les relit encore — et décide sur une identité périmée.
 * `requestId` reste : il relie les journaux tardifs.
 *
 * Serveur vivant : 127.0.0.1:5152 (HTTPS) + wss://localhost:5152.
 * Routes : src/modules/test/.../AlsController.ts (préfixe /nodefony/test/als-test).
 */
import { expect } from "vitest";
import https from "node:https";
import WebSocket from "ws";
import { rawDataText } from "../helpers/wsText";

const BASE = { hostname: "127.0.0.1", port: 5152, rejectUnauthorized: false };
const WSS = "wss://localhost:5152";

type Json = Record<string, unknown>;

function get(path: string): Promise<{ status: number; body: Json }> {
  return new Promise((resolve, reject) => {
    const r = https.request({ ...BASE, method: "GET", path }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf-8");
        resolve({
          status: res.statusCode ?? 0,
          body: raw ? (JSON.parse(raw) as Json) : {},
        });
      });
    });
    r.on("error", reject);
    r.end();
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Attend la lecture du travail détaché, sondée sur l'état de la sonde. */
async function detachedReading(key: string): Promise<Json | undefined> {
  for (let i = 0; i < 100; i++) {
    const { body } = await get("/nodefony/test/als-test/detached/state");
    const reading = body[key] as Json | undefined;
    if (reading) return reading;
    await wait(20);
  }
  return undefined;
}

describe("#571 — l'identité quitte l'ALS avec son unité de travail", () => {
  beforeEach(async () => {
    await get("/nodefony/test/als-test/reset");
  });

  it("HTTP : un minuteur armé pendant la requête ne relit ni user, ni userId, ni token après le nettoyage", async () => {
    const r = await get("/nodefony/test/als-test/detached");
    expect(r.status).to.equal(200);
    const id = r.body.contextRequestId as string;
    const reading = await detachedReading(id);
    expect(reading, "le travail détaché n'a rien lu").to.not.equal(undefined);
    expect(reading).to.deep.equal({
      cleaned: true,
      user: null,
      userId: null,
      token: false,
      requestId: id,
    });
  });

  it("WebSocket : la connexion fermée ne laisse ni user, ni userId, ni token au travail détaché", async () => {
    const id = await new Promise<string>((resolve, reject) => {
      const ws = new WebSocket(`${WSS}/nodefony/test/als-test/ws/detached`, {
        rejectUnauthorized: false,
      });
      ws.on("message", (data: WebSocket.RawData) => {
        const msg = JSON.parse(rawDataText(data)) as Json;
        ws.close();
        resolve(msg.requestId as string);
      });
      ws.on("error", reject);
    });
    const reading = await detachedReading(id);
    expect(reading, "le travail détaché n'a rien lu").to.not.equal(undefined);
    expect(reading).to.deep.equal({
      cleaned: true,
      user: null,
      userId: null,
      token: false,
      requestId: id,
    });
  });
});
