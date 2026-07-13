/// <reference types="node" />
/**
 * Integration — fermeture du bug « renderJson via le pont api.request ».
 * Requires: server running on 5152 (wss). Start: /start-server
 *
 * Bug reproduit en réel (Playground, « Envoyer Socket » sur une action qui
 * `return this.renderJson(...)`) :
 *  1. `renderJson` → `context.send()` écrivait une frame JSON **NUE** sur la
 *     socket (hors protocole JSON-RPC) ;
 *  2. le retour de l'action (= `WebsocketResponse`, circulaire via `context`)
 *     partait en `result` → `JSON.stringify` throw « Converting circular
 *     structure to JSON » → chaîne du peer cassée → **unhandledRejection**
 *     serveur + timeout SILENCIEUX côté client.
 *
 * Gates de fermeture :
 *  1. `api.request` sur une action RENDUE → réponse `{id, result}` avec le
 *     payload JSON (capturé, pas écrit en frame nue) ≡ GET REST ;
 *  2. AUCUNE frame hors-protocole (sans `id` ni `method`) pendant l'appel ;
 *  3. contrôle positif : la même action en GET REST sert le même payload.
 */
import { expect } from "chai";
import https from "node:https";
import WebSocket from "ws";

const BASE = { hostname: "127.0.0.1", port: 5152, rejectUnauthorized: false };
const AUTH = "/nodefony/security/api/auth";
const HUB_URL = "wss://127.0.0.1:5152/nodefony/studio/api/realtime";
const RENDERED_PATH = "/poc/r-books/meta/rendered";
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
  expect(res.status, "login").to.equal(200);
  const cookie = sessionCookieOf(res);
  expect(cookie, "session cookie").to.be.a("string");
  return cookie as string;
}

type JsonRpcReply = {
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: { status?: number } };
};

/**
 * Connexion hub minimaliste qui, EN PLUS de l'appairage par id, COLLECTE toute
 * frame hors-protocole (ni `id` ni `method`) — la signature du bug (frame nue
 * écrite par `context.send()` en contournant l'enveloppe JSON-RPC).
 */
function hubConnect(cookie: string): Promise<{
  request: (path: string) => Promise<JsonRpcReply>;
  strayFrames: () => unknown[];
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(HUB_URL, {
      rejectUnauthorized: false,
      headers: { cookie },
    });
    const pending = new Map<number, (r: JsonRpcReply) => void>();
    const stray: unknown[] = [];
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
      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(String(data)) as Record<string, unknown>;
      } catch {
        stray.push(String(data)); // même pas du JSON → hors protocole
        return;
      }
      if (frame.method === "realtime:welcome") {
        clearTimeout(timer);
        resolve({
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
          strayFrames: () => [...stray],
          close: () => ws.close(),
        });
        return;
      }
      if (typeof frame.id === "number" && !frame.method) {
        pending.get(frame.id as number)?.(frame as unknown as JsonRpcReply);
        pending.delete(frame.id as number);
        return;
      }
      // Notification serveur légitime = a un `method` ; tout le reste = nu.
      if (frame.method === undefined) stray.push(frame);
    });
  });
}

describe("Pont api.request — action RENDUE (renderJson) (requires server)", () => {
  it("api.request sur une action renderJson → result = payload JSON ≡ GET REST, zéro frame nue", async () => {
    const cookie = await loginCookie("admin", "secret");

    // Contrôle positif — le GET REST sert le payload rendu.
    const rest = await request(RENDERED_PATH, "GET", { cookie });
    expect(rest.status, "GET REST").to.equal(200);
    const restBody = rest.body as { rendered?: boolean; books?: unknown[] };
    expect(restBody.rendered, "payload REST").to.equal(true);
    expect(restBody.books, "books REST").to.be.an("array");

    // Même action par la socket : le rendu doit être CAPTURÉ et servi en
    // `result` (avant le fix : frame nue + unhandledRejection + timeout).
    const hub = await hubConnect(cookie);
    try {
      const reply = await hub.request(RENDERED_PATH);
      expect(reply.error, "pas d'erreur RPC").to.equal(undefined);
      const result = reply.result as { rendered?: boolean; books?: unknown[] };
      expect(result, "result").to.be.an("object");
      expect(result.rendered, "payload socket").to.equal(true);
      expect(result.books, "books socket").to.deep.equal(restBody.books);
      // Signature du bug : payload écrit en frame NUE hors enveloppe JSON-RPC.
      expect(hub.strayFrames(), "frames hors protocole").to.deep.equal([]);
    } finally {
      hub.close();
    }
  });

  it("un result non sérialisable ne casse jamais la chaîne : les requêtes SUIVANTES répondent", async () => {
    // Filet fail-safe : même si une action renvoie un jour un objet non
    // JSON-safe, le peer doit répondre (erreur -32603) et la connexion rester
    // utilisable — avant le fix, la chaîne cassait (unhandledRejection) et le
    // client restait en timeout. Ici on prouve la continuité de service : un
    // appel rendu, puis un appel nu, sur la MÊME connexion.
    const cookie = await loginCookie("admin", "secret");
    const hub = await hubConnect(cookie);
    try {
      const first = await hub.request(RENDERED_PATH);
      expect(first.error, "1er appel").to.equal(undefined);
      const second = await hub.request("/poc/r-books");
      expect(second.error, "2e appel (valeur nue)").to.equal(undefined);
      expect(second.result, "books nus").to.be.an("array");
    } finally {
      hub.close();
    }
  });
});
