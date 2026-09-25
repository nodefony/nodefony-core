/// <reference types="node" />
/**
 * Portée `request` de l'injecteur, sur le serveur RÉEL (#485).
 *
 * Les tests unitaires du cœur ouvrent leurs bulles eux-mêmes ; ceux-ci passent
 * par le pipeline : scope ouvert par `HttpKernel`, posé dans l'ALS, contrôleur
 * construit par le `Resolver`, fermeture au teardown — en HTTP et en WebSocket,
 * où le scope est celui de la CONNEXION.
 *
 * Serveur : 127.0.0.1:5152 (HTTPS) + wss://localhost:5152.
 * Routes : src/modules/test/.../RequestScopeController.ts
 *   GET /nodefony/test/request-scope/probe        — sonde d'une requête
 *   GET /nodefony/test/request-scope/state        — clean() reçus, et leur ordre
 *   WS  /nodefony/test/request-scope/ws           — résolution à chaque message
 *   GET /nodefony/test/request-scope-captive/     — contrôleur singleton captif
 */
import { expect } from "chai";
import https from "node:https";
import WebSocket from "ws";
import { drainTo } from "../helpers/scopeDrain.js";

const BASE = { hostname: "127.0.0.1", port: 5152, rejectUnauthorized: false };
const WSS = "wss://localhost:5152";
const PREFIX = "/nodefony/test/request-scope";

type Json = Record<string, unknown>;

function get(path: string): Promise<{ status: number; body: Json }> {
  return new Promise((resolve, reject) => {
    const r = https.request({ ...BASE, method: "GET", path }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf-8");
        try {
          resolve({
            status: res.statusCode!,
            body: raw ? JSON.parse(raw) : {},
          });
        } catch (e) {
          reject(e);
        }
      });
    });
    r.on("error", reject);
    r.end();
  });
}

interface IProbeState {
  cleanedBySerial: Record<string, number>;
  cleanOrderBySerial: Record<string, string[]>;
}

/**
 * Attend que l'exemplaire `serial` ait été nettoyé : le teardown suit l'envoi
 * de la réponse, le client peut la lire avant. On attend le SIGNAL, jamais un
 * délai fixe ; la borne ne sert qu'à échouer proprement s'il ne vient pas.
 */
async function cleanedState(serial: number): Promise<IProbeState> {
  const deadline = Date.now() + 5000;
  let state = (await get(`${PREFIX}/state`)).body as unknown as IProbeState;
  while (state.cleanedBySerial[serial] === undefined && Date.now() < deadline) {
    await new Promise((r) => setImmediate(r));
    state = (await get(`${PREFIX}/state`)).body as unknown as IProbeState;
  }
  return state;
}

async function liveScopes(): Promise<number> {
  return (await get("/nodefony/test/als-test/scopes")).body
    .requestScopes as number;
}

/** Une connexion : chaque message part après la réponse au précédent. */
function wsSession(path: string, messages: string[]): Promise<Json[]> {
  return new Promise((resolve, reject) => {
    const received: Json[] = [];
    const ws = new WebSocket(`${WSS}${path}`, { rejectUnauthorized: false });
    let sent = 0;
    ws.on("message", (data: WebSocket.RawData) => {
      try {
        received.push(JSON.parse(data.toString()) as Json);
      } catch (e) {
        ws.terminate();
        return reject(e);
      }
      if (sent < messages.length) {
        ws.send(messages[sent++]);
      } else {
        ws.close();
      }
    });
    ws.on("close", () => resolve(received));
    ws.on("error", reject);
  });
}

describe("#485 — portée request de l'injecteur, sur le serveur réel", () => {
  it("HTTP : un exemplaire par requête, partagé par ses consommateurs et rangé sur SON scope", async () => {
    const [a, b] = await Promise.all([
      get(`${PREFIX}/probe`),
      get(`${PREFIX}/probe`),
    ]);
    for (const [label, r] of [
      ["A", a],
      ["B", b],
    ] as const) {
      expect(r.status, `requête ${label}`).to.equal(200);
      expect(r.body.sameInConsumer, `${label} : consommateur`).to.equal(true);
      expect(r.body.sameOnResolve, `${label} : nouvelle résolution`).to.equal(
        true,
      );
      expect(r.body.ownedByScope, `${label} : rangé sur le scope`).to.equal(
        true,
      );
      expect(r.body.bornIn, `${label} : né dans CETTE requête`).to.equal(
        r.body.requestId,
      );
    }
    expect(
      a.body.serial,
      "deux requêtes concurrentes, deux exemplaires",
    ).to.not.equal(b.body.serial);
  });

  it("HTTP : clean() appelé une fois par service après la réponse, du dernier créé au premier", async () => {
    const r = await get(`${PREFIX}/probe`);
    expect(r.status).to.equal(200);
    const serial = r.body.serial as number;
    const state = await cleanedState(serial);
    expect(state.cleanedBySerial[serial], "une seule fois").to.equal(1);
    expect(state.cleanOrderBySerial[serial], "LIFO").to.deep.equal([
      "requestProbeConsumer",
      "requestProbe",
    ]);
  });

  it('HTTP : un contrôleur @Scope("singleton") qui réclame un service request est refusé, en nommant les deux', async () => {
    for (const attempt of [1, 2]) {
      const r = await get("/nodefony/test/request-scope-captive/");
      expect(r.status, `tentative ${attempt}`).to.equal(500);
      expect(r.body.message).to.match(/Dépendance captive refusée/);
      expect(r.body.message).to.match(/RequestScopeCaptiveController/);
      expect(r.body.message).to.match(/RequestProbe/);
    }
    const health = await get("/nodefony/test/index");
    expect(health.status, "le serveur reste sain").to.equal(200);
  });

  it("WebSocket : une connexion, trois messages — même exemplaire, nettoyé une fois à la fermeture", async () => {
    const before = await liveScopes();
    const msgs = await wsSession(`${PREFIX}/ws`, ["a", "b", "c"]);
    expect(msgs, "handshake + 3 messages").to.have.length(4);
    const serial = msgs[0].serial as number;
    expect(msgs[0].handshake).to.equal(true);
    msgs.forEach((m, i) => {
      expect(m.serial, `réponse ${i} : même exemplaire`).to.equal(serial);
      expect(m.sameAsController, `réponse ${i} : celui du contrôleur`).to.equal(
        true,
      );
    });
    const state = await cleanedState(serial);
    expect(state.cleanedBySerial[serial], "une fois, à la fermeture").to.equal(
      1,
    );
    const delta = await drainTo(liveScopes, before, 1);
    expect(delta, "scope de la connexion refermé").to.be.at.most(0);
  });
});
