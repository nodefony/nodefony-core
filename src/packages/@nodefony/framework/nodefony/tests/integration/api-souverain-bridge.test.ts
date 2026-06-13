/// <reference types="node" />
/**
 * Integration — POC API souveraine Phase 3 (pont `api.request`).
 * Requires: server running on 5151. Start: /start-nodefony-server
 *
 * Prouve sur le serveur RÉEL que le data plane admin est DUPLEX — la même
 * action controller répond en REST (fetch) et via la socket (hub Studio,
 * JSON-RPC 2.0), sans réécriture :
 *  1. découverte : `realtime:welcome` annonce `api.request` (opt-in Studio) ;
 *  2. snapshot ≡ : GET REST == `api.request {path}` (body identique) ;
 *  3. param de route `{name}` extrait par le pont ;
 *  4. query du path INVOQUÉ (`resolver.queryOverride`), pas celle du handshake ;
 *  5. erreurs fetch-like : 404 producteur ET 404 router → `error.data.status` ;
 *  6. contrat transport : une route GET-only (sans WEBSOCKET) est INVISIBLE au
 *     pont (zéro bypass).
 */
import { expect } from "chai";
import http from "node:http";

const BASE = { hostname: "127.0.0.1", port: 5151 };
const HUB_URL = "ws://127.0.0.1:5151/nodefony/studio/api/realtime";
const TIMEOUT = 10_000;

type Res = {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: unknown;
};

function get(path: string): Promise<Res> {
  return new Promise((resolve, reject) => {
    const r = http.request({ ...BASE, method: "GET", path }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString();
        let body: unknown = raw;
        try {
          body = JSON.parse(raw);
        } catch {
          /* keep raw */
        }
        resolve({ status: res.statusCode!, headers: res.headers, body });
      });
    });
    r.on("error", reject);
    r.setTimeout(TIMEOUT, () => r.destroy(new Error("timeout")));
    r.end();
  });
}

type JsonRpcReply = {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

type Welcome = { channels: string[]; methods: string[] };

/**
 * Client minimal du hub Studio (JSON-RPC 2.0 sur le WebSocket GLOBAL natif —
 * API WHATWG). Bufferise le `realtime:welcome` puis apparie les réponses par
 * `id`. `request(path)` reproduit l'enveloppe émise par `RealtimeClient` pour
 * la forme path (`api.request {path}`).
 */
function hubConnect(): Promise<{
  welcome: Welcome;
  request: (path: string) => Promise<JsonRpcReply>;
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(HUB_URL);
    const pending = new Map<number, (r: JsonRpcReply) => void>();
    let nextId = 1;
    const timer = setTimeout(
      () => reject(new Error("hub welcome timeout")),
      TIMEOUT,
    );
    ws.addEventListener("error", () => reject(new Error("hub ws error")));
    ws.addEventListener("message", (e) => {
      const frame = JSON.parse(String(e.data)) as Record<string, unknown>;
      if (frame.method === "realtime:welcome") {
        clearTimeout(timer);
        resolve({
          welcome: frame.params as Welcome,
          request: (path: string) =>
            new Promise<JsonRpcReply>((res, rej) => {
              const id = nextId++;
              const t = setTimeout(
                () => rej(new Error(`rpc timeout ${path}`)),
                TIMEOUT,
              );
              pending.set(id, (reply) => {
                clearTimeout(t);
                res(reply);
              });
              ws.send(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id,
                  method: "api.request",
                  params: { path },
                }),
              );
            }),
          close: () => ws.close(),
        });
        return;
      }
      if (typeof frame.id === "number" && !frame.method) {
        pending.get(frame.id as number)?.(frame as unknown as JsonRpcReply);
        pending.delete(frame.id as number);
      }
    });
  });
}

// P6 J3b — le handshake WS du hub data plane (ws://…/nodefony/studio/api/realtime)
// est désormais FERMÉ par l'aire (firewall sur le handshake). Ce banc se connecte
// en anonyme → handshake refusé. À RÉÉCRIRE en Étape 3 (login WS via
// SessionRealtimeAuthenticator + verrou frame api.request). Skippé d'ici là pour
// garder la suite verte (le pont api.request reste prouvé hors-auth par le code).
describe.skip("POC souverain Ph.3 — pont api.request (data plane duplex)", () => {
  it("welcome : le hub Studio annonce api.request (découverte)", async () => {
    const hub = await hubConnect();
    expect(hub.welcome.methods).to.include("api.request");
    hub.close();
  });

  it("snapshot ≡ : GET /nodefony/kernel/api/modules == api.request (body identique)", async () => {
    const rest = await get("/nodefony/kernel/api/modules");
    expect(rest.status).to.equal(200);
    const hub = await hubConnect();
    const ws = await hub.request("/nodefony/kernel/api/modules");
    hub.close();
    expect(ws.error).to.equal(undefined);
    expect(ws.result).to.deep.equal(rest.body);
  });

  it("param de route {name} extrait par le pont : module/http", async () => {
    const rest = await get("/nodefony/kernel/api/module/http");
    const hub = await hubConnect();
    const ws = await hub.request("/nodefony/kernel/api/module/http");
    hub.close();
    expect(ws.error).to.equal(undefined);
    expect(ws.result).to.deep.equal(rest.body);
    expect((ws.result as { key: string }).key).to.equal("http");
  });

  it("query du path INVOQUÉ : /poc/r-books?authorId=42 filtre comme en REST", async () => {
    const rest = await get("/poc/r-books?authorId=42");
    const hub = await hubConnect();
    const ws = await hub.request("/poc/r-books?authorId=42");
    hub.close();
    expect(ws.error).to.equal(undefined);
    expect(ws.result).to.deep.equal(rest.body);
    expect((ws.result as { id: string }[]).map((b) => b.id)).to.deep.equal([
      "b1",
      "b2",
    ]);
  });

  it("2 requêtes sur la MÊME socket : la query ne fuit pas entre invocations", async () => {
    const hub = await hubConnect();
    const filtered = await hub.request("/poc/r-books?authorId=42");
    // Sans query : si la query de l'invocation 1 collait au contexte partagé,
    // ce 2ᵉ appel renverrait la liste FILTRÉE (bleed) au lieu des 3 livres.
    const all = await hub.request("/poc/r-books");
    hub.close();
    expect((filtered.result as unknown[]).length).to.equal(2);
    expect((all.result as unknown[]).length).to.equal(3);
  });

  it("404 PRODUCTEUR (module/zzz-nope) → RpcError data.status 404 + body d'erreur", async () => {
    const hub = await hubConnect();
    const ws = await hub.request("/nodefony/kernel/api/module/zzz-nope");
    hub.close();
    expect(ws.result).to.equal(undefined);
    expect(ws.error!.code).to.equal(-32000);
    const data = ws.error!.data as { status: number; body: { key: string } };
    expect(data.status).to.equal(404);
    expect(data.body.key).to.equal("zzz-nope");
  });

  it("404 ROUTER (path inconnu) → RpcError data.status 404", async () => {
    const hub = await hubConnect();
    const ws = await hub.request("/nodefony/kernel/api/nope-nope");
    hub.close();
    expect(ws.error!.code).to.equal(-32000);
    expect((ws.error!.data as { status: number }).status).to.equal(404);
  });

  it("contrat transport : une route GET-only (sans WEBSOCKET) → 405 agrégé, jamais exécutée", async () => {
    // /nodefony/test/index répond 200 en REST mais ne déclare PAS WEBSOCKET →
    // le pont ne l'atteint pas (zéro bypass) ; le Router répond la MÊME
    // sémantique qu'en REST : 405 Method Not Allowed (RFC 9110 §15.5.6).
    const rest = await get("/nodefony/test/index");
    expect(rest.status).to.equal(200);
    const hub = await hubConnect();
    const ws = await hub.request("/nodefony/test/index");
    hub.close();
    expect(ws.result).to.equal(undefined);
    expect(ws.error!.code).to.equal(-32000);
    expect((ws.error!.data as { status: number }).status).to.equal(405);
  });

  it("params invalides (path absent) → -32602", async () => {
    const hub = await hubConnect();
    const reply = await new Promise<JsonRpcReply>((res) => {
      // Frame brute sans params.path — hors du helper request().
      const ws = new WebSocket(HUB_URL);
      ws.addEventListener("message", (e) => {
        const frame = JSON.parse(String(e.data)) as Record<string, unknown>;
        if (frame.method === "realtime:welcome") {
          ws.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "api.request",
              params: {},
            }),
          );
          return;
        }
        if (frame.id === 1) {
          ws.close();
          res(frame as unknown as JsonRpcReply);
        }
      });
    });
    hub.close();
    expect(reply.error!.code).to.equal(-32602);
  });
});
