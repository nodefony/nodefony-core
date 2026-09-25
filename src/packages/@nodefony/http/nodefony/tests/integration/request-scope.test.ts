/// <reference types="node" />
/**
 * Scope de requête atteint par l'ALS — `RequestContext.getScope()` (#484).
 *
 * `HttpKernel` pose le scope de la requête dans la charge utile de l'ALS, aux
 * deux sites `RequestContext.run` (requête HTTP ; handshake WebSocket, dont
 * les messages héritent). Ces tests prouvent chaque site sur le serveur RÉEL :
 * retirer `scope` d'un littéral les fait tomber, alors que les tests unitaires
 * du cœur — qui ouvrent leurs bulles eux-mêmes — resteraient verts.
 *
 * Serveur : 127.0.0.1:5152 (HTTPS) + wss://localhost:5152.
 * Routes : src/modules/test/.../AlsController.ts (préfixe /nodefony/test/als-test)
 *   GET /scope — `getScope() === context.container` + hook onAfterResponse
 *   WS  /ws    — `alsScopeIsContainer` au handshake et à chaque message
 */
import { expect } from "chai";
import https from "node:https";
import WebSocket from "ws";

const BASE = { hostname: "127.0.0.1", port: 5152, rejectUnauthorized: false };
const WSS = "wss://localhost:5152";
const SCOPE_ROUTE = "/nodefony/test/als-test/scope";

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

/**
 * Relit l'état jusqu'à ce que le hook de la requête `ctxId` ait tourné. On
 * attend le SIGNAL (la valeur publiée par le hook), jamais un délai fixe ; la
 * borne ne sert qu'à échouer proprement si le hook ne tourne jamais.
 */
async function hookVerdict(
  ctxId: string,
  field: "scopeInHook" | "scopeAfterTeardown" = "scopeInHook",
): Promise<boolean | undefined> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const { body } = await get("/nodefony/test/als-test/scope/hooks");
    const verdict = (body[field] as Record<string, boolean> | undefined)?.[
      ctxId
    ];
    if (verdict !== undefined) return verdict;
    await new Promise((r) => setImmediate(r));
  }
  return undefined;
}

/**
 * Ouvre une socket, envoie chaque message après la réponse précédente, et
 * rend toutes les réponses JSON, handshake compris.
 */
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

describe("#484 — RequestContext.getScope() sur le serveur réel", () => {
  it("HTTP : getScope() rend le scope de CE contexte, et deux requêtes concurrentes chacune le leur", async () => {
    const [a, b] = await Promise.all([get(SCOPE_ROUTE), get(SCOPE_ROUTE)]);
    expect(a.status).to.equal(200);
    expect(b.status).to.equal(200);
    expect(a.body.contextRequestId).to.not.equal(b.body.contextRequestId);
    expect(a.body.scopeIsContainer, "requête A").to.equal(true);
    expect(b.body.scopeIsContainer, "requête B").to.equal(true);
  });

  it("HTTP : un hook onAfterResponse voit encore le scope ouvert — il passe avant leaveScope", async () => {
    const r = await get(SCOPE_ROUTE);
    expect(r.status).to.equal(200);
    const ctxId = r.body.contextRequestId as string;
    expect(
      await hookVerdict(ctxId),
      "le hook doit tourner et trouver le scope ouvert",
    ).to.equal(true);
  });

  it("HTTP : une continuation qui reprend après la fin de la requête ne reçoit plus le scope — il est refermé", async () => {
    const r = await get(SCOPE_ROUTE);
    expect(r.status).to.equal(200);
    const ctxId = r.body.contextRequestId as string;
    expect(
      await hookVerdict(ctxId, "scopeAfterTeardown"),
      "la bulle porte encore le scope, getScope() doit le refuser",
    ).to.equal(true);
  });

  it("WebSocket : le handshake et chaque message atteignent le scope de la connexion", async () => {
    const msgs = await wsSession("/nodefony/test/als-test/ws", ["a", "b"]);
    expect(msgs).to.have.length(3);
    msgs.forEach((m, i) =>
      expect(m.alsScopeIsContainer, `réponse ${i}`).to.equal(true),
    );
  });
});
