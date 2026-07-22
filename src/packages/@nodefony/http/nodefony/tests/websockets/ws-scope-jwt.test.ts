/// <reference types="node" />
/**
 * Integration — **le downscoping d'une clé machine tient AUSSI sur la socket**.
 * Requires: server running on 5152 (wss). Start: /start-server
 *
 * Un scope (`m2m:read`) ne bride pas un humain : il limite ce qu'une clé déléguée
 * a le droit de faire. Le `ScopeVoter` applique donc une règle simple — identité
 * humaine (`session`, `userpassword`) → le scope est un no-op ; identité machine
 * (`jwt`, `apikey`, OAuth) → le scope exact doit être détenu, sinon refus.
 *
 * Ce banc existe parce que cette règle a été **entièrement contournée en
 * WebSocket** : le jeton realtime s'annonçait `session` quel que soit le mode réel
 * d'authentification, donc un agent JWT était pris pour un humain et franchissait
 * tous les `@RequireScope` sans détenir un seul scope. Rien ne le voyait — les
 * bancs de scopes étaient en HTTP, où le jeton porte son vrai type.
 *
 * Il se joue de bout en bout, sur un vrai serveur, parce que c'est le seul endroit
 * où la chaîne complète existe : émission du JWT scopé → handshake WS Bearer →
 * promotion de l'identité → pont `api.request` → `@RequireScope` → voter.
 *
 *   POST /token (credential)          → access JWT portant des scopes
 *   → handshake WS `Bearer`            (firewall jwt sur le pipeline http)
 *   → FirewallRealtimeAuthenticator    (type + scopes RÉELS repris du jeton)
 *   → api.request {route scopée}       → ScopeVoter  ≡  HTTP.
 */
import { expect } from "chai";
import https from "node:https";
import WebSocket from "ws";

const BASE = { hostname: "127.0.0.1", port: 5152, rejectUnauthorized: false };
const TOKEN_URL = "/nodefony/security/api/token";
const HUB_URL = "wss://127.0.0.1:5152/nodefony/test/m2m/realtime";
/** Route WS-invocable gardée par `@RequireScope("m2m:read")` (SecureWsController). */
const SCOPED_READ = "/nodefony/test/api/scoped-read";
/** Route WS-invocable gardée par `@RequireScope("m2m:write")` — jamais accordée ici. */
const SCOPED_WRITE = "/nodefony/test/api/scoped-write";
/** Route WS-invocable de la même zone SANS exigence de scope — contrôle positif. */
const UNSCOPED = "/nodefony/test/api/admin-guarded";
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

/**
 * Password grant → access token JWT. `scope` demandé au format RFC 6749 §3.3
 * (liste séparée par des espaces) ; omis = aucun scope délégué.
 */
async function accessToken(
  username: string,
  password: string,
  scope?: string,
): Promise<string> {
  const res = await post(TOKEN_URL, {
    username,
    password,
    ...(scope ? { scope } : {}),
  });
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

/** Le statut HTTP rejoué par le pont, quelle que soit la forme de la réponse RPC. */
function statusOf(reply: JsonRpcReply): number | undefined {
  const fromResult = (reply.result as { status?: number } | undefined)?.status;
  if (typeof fromResult === "number") return fromResult;
  return (reply.error?.data as { status?: number } | undefined)?.status;
}

describe("P6.8 — downscoping d'un agent JWT sur la socket (requires server)", () => {
  it("agent PORTANT le scope → la route scopée passe", async () => {
    const token = await accessToken("admin", "secret", "m2m:read");
    const hub = await hubConnectBearer(token);
    try {
      const reply = await hub.request(SCOPED_READ);
      expect(reply.error, "un agent scopé ne doit pas être refusé").to.equal(
        undefined,
      );
      expect(reply.result).to.have.property("requiredScope", "m2m:read");
    } finally {
      hub.close();
    }
  });

  it("VECTEUR FERMÉ — agent SANS le scope → la route scopée est REFUSÉE", async () => {
    // Le cœur du banc. Avant correction, ce même appel renvoyait 200 : le jeton
    // realtime s'annonçait `session`, donc le voter le tenait pour un humain et
    // n'exigeait plus rien. Un agent obtenait par sa socket ce que la même clé ne
    // pouvait pas obtenir en HTTP.
    const token = await accessToken("admin", "secret", "m2m:read");
    const hub = await hubConnectBearer(token);
    try {
      const reply = await hub.request(SCOPED_WRITE);
      const status = statusOf(reply);
      expect(
        status,
        `agent sans "m2m:write" doit être refusé (403), reçu ${String(status)}`,
      ).to.equal(403);
    } finally {
      hub.close();
    }
  });

  it("agent SANS AUCUN scope → toute route scopée est refusée", async () => {
    const token = await accessToken("admin", "secret");
    const hub = await hubConnectBearer(token);
    try {
      expect(statusOf(await hub.request(SCOPED_READ))).to.equal(403);
      expect(statusOf(await hub.request(SCOPED_WRITE))).to.equal(403);
    } finally {
      hub.close();
    }
  });

  it("CONTRÔLE POSITIF — la même socket sert les routes NON scopées", async () => {
    // Sans ce contre-test, un « 403 partout » (socket cassée, zone fermée) se
    // lirait comme une défense qui marche. C'est ce tir-là qui prouve que le
    // refus ci-dessus vient du scope, et non de la connexion.
    const token = await accessToken("admin", "secret");
    const hub = await hubConnectBearer(token);
    try {
      const reply = await hub.request(UNSCOPED);
      expect(reply.error, "route non scopée refusée").to.equal(undefined);
      expect(reply.result).to.have.property("granted", true);
    } finally {
      hub.close();
    }
  });

  it("l'agent RESTE connecté : aucune session n'est exigée d'un jeton porteur", async () => {
    // Régression F84 : une socket authentifiée par JWT était révoquée au motif
    // qu'elle n'avait pas de session BFF à relire. Deux requêtes espacées
    // prouvent que la connexion vit au-delà du handshake.
    const token = await accessToken("admin", "secret");
    const hub = await hubConnectBearer(token);
    try {
      expect((await hub.request(UNSCOPED)).error).to.equal(undefined);
      await new Promise((r) => setTimeout(r, 500));
      expect((await hub.request(UNSCOPED)).error).to.equal(undefined);
    } finally {
      hub.close();
    }
  });
});
