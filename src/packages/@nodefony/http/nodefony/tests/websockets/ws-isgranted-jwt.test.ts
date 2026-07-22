/// <reference types="node" />
/**
 * Integration — P6 J8 (volet b) : garde `@IsGranted` via `api.request` sur un hub
 * realtime authentifié **JWT Bearer** (mode agent / M2M, SANS cookie).
 * Requires: server running on 5152 (wss). Start: /start-server
 *
 * Prouve « 1 garde = N transports ET N modes d'authentification » : la même garde
 * `@IsGranted("ROLE_ADMIN")` qui décide en HTTP (J7) et en WS cookie/BFF (volet a)
 * décide AUSSI en WS JWT. Aucun `JwtRealtimeAuthenticator` : le firewall (zone
 * `test-api`, authenticator `jwt`) résout l'identité au handshake → ALS →
 * `FirewallRealtimeAuthenticator` (câblé par zone) → `UserRealtimeToken`.
 *
 *   POST /token (credential)       → access JWT (security)
 *   → handshake WS `Bearer`         (firewall jwt sur le pipeline http)
 *   → FirewallRealtimeAuthenticator  (lit l'identité de l'ALS, 0 re-vérif)
 *   → token posé sur le peer         (realtime hub)
 *   → api.request {path gardé}       → garde @IsGranted (Resolver)  ≡  HTTP.
 */
import { expect } from "chai";
import https from "node:https";
import WebSocket from "ws";

const BASE = { hostname: "127.0.0.1", port: 5152, rejectUnauthorized: false };
const TOKEN_URL = "/nodefony/security/api/token";
const HUB_URL = "wss://127.0.0.1:5152/nodefony/test/m2m/realtime";
const GUARDED = "/nodefony/test/api/admin-guarded";
const TIMEOUT = 10_000;

type Res = { status: number; body: unknown };

function post(path: string, payload: unknown): Promise<Res> {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(payload));
    const req = https.request(
      {
        ...BASE,
        path,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(data.length),
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
          resolve({ status: res.statusCode!, body });
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(TIMEOUT, () => req.destroy(new Error("http timeout")));
    req.write(data);
    req.end();
  });
}

/** Password grant (RFC 6749 §5.1) → access token JWT. */
async function accessToken(
  username: string,
  password: string,
): Promise<string> {
  const res = await post(TOKEN_URL, { username, password });
  expect(res.status, `token grant ${username} attendu 200`).to.equal(200);
  const token = (res.body as { access_token?: unknown }).access_token;
  expect(token, "access_token attendu").to.be.a("string");
  return token as string;
}

type JsonRpcReply = {
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

/** Connecte au hub M2M avec un `Authorization: Bearer` → welcome + appaire par id. */
function hubConnectBearer(token: string): Promise<{
  request: (path: string) => Promise<JsonRpcReply>;
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(HUB_URL, {
      rejectUnauthorized: false,
      headers: { authorization: `Bearer ${token}` },
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

describe("P6 J8 volet b — garde @IsGranted via api.request sur hub JWT (requires server)", () => {
  it("admin (ROLE_ADMIN, JWT Bearer) → GRANT : { granted:true, identifier:'admin' }", async () => {
    const token = await accessToken("admin", "secret");
    const hub = await hubConnectBearer(token);
    const reply = await hub.request(GUARDED);
    hub.close();
    expect(reply.error, "admin JWT ne doit pas être refusé").to.equal(
      undefined,
    );
    expect(reply.result).to.deep.equal({ granted: true, identifier: "admin" });
  });

  it("user (ROLE_USER, JWT Bearer : authentifié mais SANS le rôle) → 403 exposé", async () => {
    const token = await accessToken("user", "secret");
    const hub = await hubConnectBearer(token);
    const reply = await hub.request(GUARDED);
    hub.close();
    expect(reply.result, "user ne doit obtenir aucun résultat").to.equal(
      undefined,
    );
    expect(
      reply.error,
      "user authentifié mais non autorisé → refus",
    ).to.not.equal(undefined);
    // Identité issue d'un JWT cette fois — la garde décide pareil qu'en cookie.
    const data = reply.error?.data as { status?: number } | undefined;
    expect(data?.status, "statut d'autorisation exposé").to.equal(403);
  });
});
