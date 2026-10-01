/// <reference types="node" />
/**
 * Integration — portée des contrôleurs (#506), sur le serveur réel.
 * Requires: server running on 5152 (https/wss). Start: /start-server
 *
 * Les contrôleurs sont singletons par défaut : UNE instance par classe sert
 * toutes les requêtes. Ce banc prouve, par le fil, ce que le passage rend
 * vulnérable et qu'aucun test unitaire ne voit en entier :
 *
 *  1. le plan d'administration dit la portée de chaque route (colonne `scope`
 *     de `inspect routes`, de Studio et du serveur MCP) ;
 *  2. le pont `api.request` : des appels CONCURRENTS de la même socket vers un
 *     contrôleur SINGLETON (`AdminApiController`, le data plane de Studio)
 *     rendent chacun la route et la query de LEUR chemin — identiques au GET
 *     REST du même chemin.
 */
import { expect } from "vitest";
import https from "node:https";
import WebSocket from "ws";

const BASE = { hostname: "127.0.0.1", port: 5152, rejectUnauthorized: false };
const HUB_URL = "wss://127.0.0.1:5152/nodefony/studio/api/realtime";
const TIMEOUT = 10_000;

type Res = { status: number; headers: Record<string, unknown>; body: unknown };

function request(
  path: string,
  method: string,
  headers: Record<string, string> = {},
  payload?: unknown,
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const data =
      payload === undefined ? null : Buffer.from(JSON.stringify(payload));
    const req = https.request(
      {
        ...BASE,
        path,
        method,
        headers: {
          ...headers,
          ...(data
            ? {
                "content-type": "application/json",
                "content-length": String(data.length),
              }
            : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString();
          let body: unknown = raw;
          try {
            body = JSON.parse(raw);
          } catch {
            /* texte brut */
          }
          resolve({ status: res.statusCode!, headers: res.headers, body });
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(TIMEOUT, () => req.destroy(new Error("http timeout")));
    if (data) req.write(data);
    req.end();
  });
}

async function adminCookie(): Promise<string> {
  const res = await request(
    "/nodefony/security/api/auth/login",
    "POST",
    {},
    { username: "admin", password: "secret-de-dev-42" },
  );
  expect(res.status, "login admin attendu 200").to.equal(200);
  const setCookie = res.headers["set-cookie"];
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  expect(first, "cookie de session attendu au login").to.be.a("string");
  return String(first).split(";")[0]!;
}

type Reply = { id: number; result?: unknown; error?: { message: string } };

/** Socket authentifiée sur le hub de Studio, prête pour `api.request`. */
function hubConnect(cookie: string): Promise<{
  request: (path: string) => Promise<Reply>;
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(HUB_URL, {
      rejectUnauthorized: false,
      headers: { cookie },
    });
    const pending = new Map<number, (r: Reply) => void>();
    let nextId = 1;
    const timer = setTimeout(
      () => reject(new Error("welcome timeout")),
      TIMEOUT,
    );
    ws.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    ws.on("message", (data: Buffer) => {
      const frame = JSON.parse(String(data)) as Record<string, unknown>;
      if (frame.method === "realtime:welcome") {
        clearTimeout(timer);
        resolve({
          request: (path: string) =>
            new Promise<Reply>((res, rej) => {
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
        pending.get(frame.id)?.(frame as unknown as Reply);
        pending.delete(frame.id);
      }
    });
  });
}

describe("Portée des contrôleurs — #506 (requires server)", () => {
  it("le plan d'administration dit la portée de chaque route", async () => {
    const cookie = await adminCookie();
    const res = await request("/nodefony/framework/api/routes", "GET", {
      cookie,
    });
    expect(res.status).to.equal(200);
    const routes = res.body as {
      path: string | null;
      controller: string | null;
      scope: string | null;
    }[];
    const scopeOf = (controller: string) =>
      routes.find((r) => r.controller === controller)?.scope;
    // Le data plane : un singleton, le défaut.
    expect(scopeOf("AdminApiController")).to.equal("singleton");
    // Déclaré par requête (il injecte un service de portée request).
    expect(scopeOf("RequestScopeController")).to.equal("request");
    // Le hub temps réel : par connexion, par construction.
    expect(scopeOf("StudioRealtimeController")).to.equal("request");
  });

  it("pont api.request : appels CONCURRENTS de la même socket vers un singleton — chacun rend SA route et SA query (≡ GET REST)", async () => {
    const cookie = await adminCookie();
    // Des chemins de routes DIFFÉRENTES, et deux queries différentes sur une
    // même route : un singleton qui lirait la route ou la query de la
    // connexion — ou celle d'un appel voisin — répondrait à côté.
    const paths = [
      "/nodefony/kernel/api/modules",
      "/nodefony/kernel/api/module/http",
      "/nodefony/kernel/api/module/framework",
      "/nodefony/framework/api/routes?q=request-scope",
      "/nodefony/framework/api/routes?q=graphql",
    ];
    const rest = await Promise.all(
      paths.map((p) => request(p, "GET", { cookie })),
    );
    for (const [i, r] of rest.entries()) {
      expect(r.status, `GET REST ${paths[i]}`).to.equal(200);
    }
    const hub = await hubConnect(cookie);
    try {
      const replies = await Promise.all(paths.map((p) => hub.request(p)));
      for (const [i, reply] of replies.entries()) {
        expect(reply.error, `api.request ${paths[i]}`).to.equal(undefined);
        expect(
          reply.result,
          `api.request ${paths[i]} ≡ GET REST`,
        ).to.deep.equal(rest[i]!.body);
      }
      // Garde-fou : les deux filtres rendent bien des résultats DIFFÉRENTS,
      // sinon l'égalité ci-dessus ne prouverait rien sur la query.
      expect(replies[3]!.result).to.not.deep.equal(replies[4]!.result);
    } finally {
      hub.close();
    }
  });
});
