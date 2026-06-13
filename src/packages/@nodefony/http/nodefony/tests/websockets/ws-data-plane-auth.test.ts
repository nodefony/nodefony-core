/// <reference types="node" />
/**
 * Integration — P6 J3b Étape 3 : VERROU WS du data plane (cross-brique).
 * Requires: server running on 5152 (wss). Start: /start-server
 *
 * Preuve END-TO-END que le pont `api.request` traverse TOUTES les briques avec
 * la sécurité active — c'est LE test qui compte pour un pont inter-modules :
 *   login (security)            → cookie de session opaque (http)
 *   → handshake WS firewall     (security sur le pipeline http)
 *   → SessionRealtimeAuthenticator (security, lit l'identité résolue dans l'ALS)
 *   → token posé sur le peer     (realtime hub)
 *   → frame `api.request`        → verrou de frame (security, `firewall.matchPath`)
 *   → executeAction              (framework router)  ≡  GET REST.
 *
 * Gates :
 *  1. handshake ANONYME (sans cookie) → REFUSÉ (jamais de welcome) ;
 *  2. handshake AUTHENTIFIÉ (cookie) → welcome + `api.request` annoncé ;
 *  3. `api.request {path}` authentifié ≡ GET REST authentifié (duplex préservé) ;
 *  4. HTTP data plane lui aussi gaté : GET sans cookie → 401.
 *
 * wss://5152 (PAS ws://5151) : le cookie `__Host-` n'existe qu'en contexte
 * sécurisé → login ET WS sur le MÊME scheme pour que le nom de cookie matche.
 */
import { expect } from "chai";
import https from "node:https";
import WebSocket from "ws";

const BASE = { hostname: "127.0.0.1", port: 5152, rejectUnauthorized: false };
const AUTH = "/nodefony/security/api/auth";
const HUB_URL = "wss://127.0.0.1:5152/nodefony/studio/api/realtime";
const TIMEOUT = 10_000;

type Res = { status: number; headers: Record<string, unknown>; body: unknown };

function request(
  path: string,
  method: string,
  headers: Record<string, string> = {},
  payload: unknown = undefined,
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
          resolve({
            status: res.statusCode!,
            headers: res.headers as Record<string, unknown>,
            body,
          });
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(TIMEOUT, () => req.destroy(new Error("http timeout")));
    if (data) req.write(data);
    req.end();
  });
}

const get = (path: string, headers: Record<string, string> = {}) =>
  request(path, "GET", headers);

/** `name=value` du PREMIER Set-Cookie (cookie de session opaque). */
function sessionCookieOf(res: Res): string | null {
  const setCookie = res.headers["set-cookie"];
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (typeof first !== "string") return null;
  return first.split(";")[0] ?? null;
}

async function loginCookie(
  identifier: string,
  password: string,
): Promise<string> {
  const res = await request(
    `${AUTH}/login`,
    "POST",
    {},
    {
      username: identifier,
      password,
    },
  );
  expect(res.status, "login attendu 200").to.equal(200);
  const cookie = sessionCookieOf(res);
  expect(cookie, "cookie de session attendu au login").to.be.a("string");
  return cookie!;
}

type JsonRpcReply = {
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

/** Connecte au hub (cookie optionnel) → bufferise welcome + appaire par id. */
function hubConnect(cookie: string | null): Promise<{
  welcome: { channels: string[]; methods: string[] };
  request: (path: string) => Promise<JsonRpcReply>;
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(HUB_URL, {
      rejectUnauthorized: false,
      headers: cookie ? { cookie } : {},
    });
    const pending = new Map<number, (r: JsonRpcReply) => void>();
    let nextId = 1;
    const timer = setTimeout(
      () => reject(new Error("welcome timeout")),
      TIMEOUT,
    );
    ws.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    ws.on("close", (code: number) => {
      clearTimeout(timer);
      reject(new Error(`closed before welcome (code=${code})`));
    });
    ws.on("message", (data: Buffer) => {
      const frame = JSON.parse(String(data)) as Record<string, unknown>;
      if (frame.method === "realtime:welcome") {
        clearTimeout(timer);
        ws.removeAllListeners("close");
        resolve({
          welcome: frame.params as { channels: string[]; methods: string[] },
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

/** Observe un handshake attendu REFUSÉ : `true` si fermé sans welcome. */
function expectRefused(cookie: string | null): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(HUB_URL, {
      rejectUnauthorized: false,
      headers: cookie ? { cookie } : {},
    });
    let welcomed = false;
    const done = (refused: boolean) => {
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* déjà fermé */
      }
      resolve(refused);
    };
    const timer = setTimeout(() => done(false), TIMEOUT); // pas de close → pas refusé
    ws.on("message", (data: Buffer) => {
      const frame = JSON.parse(String(data)) as Record<string, unknown>;
      if (frame.method === "realtime:welcome") {
        welcomed = true;
        done(false); // welcome reçu = PAS refusé
      }
    });
    ws.on("close", () => done(!welcomed));
    ws.on("error", () => {
      /* le refus peut surgir en error avant close — on attend le close */
    });
  });
}

describe("P6 J3b Étape 3 — verrou WS data plane (requires server)", () => {
  it("handshake ANONYME (sans cookie) → REFUSÉ (jamais de welcome)", async () => {
    expect(await expectRefused(null)).to.equal(true);
  });

  it("HTTP data plane gaté : GET /nodefony/kernel/api/modules sans cookie → 401", async () => {
    const res = await get("/nodefony/kernel/api/modules");
    expect(res.status).to.equal(401);
  });

  it("handshake AUTHENTIFIÉ (cookie) → welcome + api.request annoncé", async () => {
    const cookie = await loginCookie("admin", "secret");
    const hub = await hubConnect(cookie);
    expect(hub.welcome.methods).to.include("api.request");
    hub.close();
  });

  it("api.request authentifié ≡ GET REST authentifié (duplex préservé après le verrou)", async () => {
    const cookie = await loginCookie("admin", "secret");
    const rest = await get("/nodefony/kernel/api/modules", { cookie });
    expect(rest.status, "GET REST authentifié 200").to.equal(200);
    const hub = await hubConnect(cookie);
    const ws = await hub.request("/nodefony/kernel/api/modules");
    hub.close();
    expect(
      ws.error,
      "api.request authentifié ne doit pas être refusé",
    ).to.equal(undefined);
    expect(ws.result).to.deep.equal(rest.body);
  });

  it("param de route {name} : api.request authentifié == GET REST", async () => {
    const cookie = await loginCookie("admin", "secret");
    const rest = await get("/nodefony/kernel/api/module/http", { cookie });
    const hub = await hubConnect(cookie);
    const ws = await hub.request("/nodefony/kernel/api/module/http");
    hub.close();
    expect(ws.error).to.equal(undefined);
    expect(ws.result).to.deep.equal(rest.body);
  });
});
