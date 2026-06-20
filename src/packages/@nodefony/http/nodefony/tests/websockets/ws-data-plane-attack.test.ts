/// <reference types="node" />
/**
 * Integration — P6 RED-TEAM : attaques sur le Firewall / WS data plane (J3b/J8).
 * Requires: server running on 5152 (wss). Start: /start-server
 *
 * DERNIÈRE brique red-team du cœur P6. Méthode 2 passes (threat-first puis
 * code-first). Ce banc PROUVE sur le VRAI pipeline (firewall + handshake + verrou
 * de frame + pont `api.request`) trois invariants architecturaux que les bancs
 * fonctionnels existants (`ws-data-plane-auth`, `ws-isgranted-jwt`) ne couvrent
 * PAS — chaque test est une attaque conçue qui DOIT être refusée :
 *
 *  A. Anti-CSWSH (garde `HttpKernel.checkWebsocketOrigin`, OWASP WSTG-CLNT-10) :
 *     les navigateurs n'appliquent PAS CORS aux WebSockets → une page tierce peut
 *     ouvrir un WS porté par le cookie de session de la victime. La garde exige
 *     une Origin same-origin (loopback toléré en dev). On rejoue le spoofing
 *     d'origine (calque CORS/CSRF : suffixe / userinfo / null) AVEC un cookie
 *     valide : le refus doit survenir AU HANDSHAKE (1008), le cookie ne sert à rien.
 *
 *  B. Identité figée à l'ALS (« 0 re-trust par frame ») : le token est résolu UNE
 *     fois au handshake et posé dans l'ALS ; une frame `api.request` ne peut PAS
 *     ré-injecter une identité (user/roles/token forgés dans les params) pour
 *     élever ses privilèges. La garde `@IsGranted` lit l'ALS, jamais le payload.
 *
 *  C. Pont `api.request` confiné à la zone data plane (`^/nodefony/[^/]+/api(/|$)`) :
 *     le pont souverain ne doit JAMAIS atteindre une route hors data plane (fuite
 *     de surface), ni par chemin direct, ni par traversée `..`, et rejette un
 *     `path` malformé avant toute résolution.
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
const GUARDED = "/nodefony/test/api/admin-guarded";
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
    { username: identifier, password },
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

/**
 * Observe un handshake : `welcomed=true` si le `realtime:welcome` arrive, sinon
 * `welcomed=false` + le `code` de fermeture WS. Permet d'injecter une `origin`
 * arbitraire (attaque CSWSH) en plus du cookie.
 */
function observeHandshake(
  cookie: string | null,
  origin?: string,
): Promise<{ welcomed: boolean; code: number }> {
  return new Promise((resolve) => {
    const headers: Record<string, string> = {};
    if (cookie) headers.cookie = cookie;
    if (origin !== undefined) headers.origin = origin;
    const ws = new WebSocket(HUB_URL, { rejectUnauthorized: false, headers });
    let welcomed = false;
    let settled = false;
    const done = (w: boolean, code = 0) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* déjà fermé */
      }
      resolve({ welcomed: w, code });
    };
    const timer = setTimeout(() => done(welcomed), TIMEOUT);
    ws.on("message", (data: Buffer) => {
      const frame = JSON.parse(String(data)) as Record<string, unknown>;
      if (frame.method === "realtime:welcome") {
        welcomed = true;
        done(true);
      }
    });
    ws.on("close", (code: number) => done(welcomed, code));
    ws.on("error", () => {
      /* le refus surgit en error avant close — on attend le close */
    });
  });
}

/**
 * Connecte au hub (cookie + origin optionnels), bufferise le welcome, puis
 * permet d'envoyer une frame `api.request` avec des `params` ARBITRAIRES (pour
 * forger une identité) et apparie la réponse par `id`.
 */
function connect(
  cookie: string | null,
  origin?: string,
): Promise<{
  call: (params: Record<string, unknown>) => Promise<JsonRpcReply>;
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (cookie) headers.cookie = cookie;
    if (origin !== undefined) headers.origin = origin;
    const ws = new WebSocket(HUB_URL, { rejectUnauthorized: false, headers });
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
          call: (params: Record<string, unknown>) =>
            new Promise<JsonRpcReply>((res, rej) => {
              const id = nextId++;
              const t = setTimeout(
                () => rej(new Error(`rpc timeout ${JSON.stringify(params)}`)),
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
                  params,
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

describe("P6 RED-TEAM — anti-CSWSH au handshake WS (requires server)", () => {
  // Le client `ws` Node n'envoie PAS d'Origin par défaut → on l'injecte
  // explicitement. Un cookie admin VALIDE accompagne chaque attaque : la garde
  // doit refuser sur la seule Origin, AVANT que le cookie ne compte (sinon CSWSH).

  it("O1 Origin cross-site (https://evil.example) + cookie admin → REFUS 1008", async () => {
    const cookie = await loginCookie("admin", "secret");
    const { welcomed, code } = await observeHandshake(
      cookie,
      "https://evil.example",
    );
    expect(
      welcomed,
      "une Origin étrangère ne doit jamais obtenir le welcome",
    ).to.equal(false);
    expect(code, "refus = 1008 Policy Violation").to.equal(1008);
  });

  it("O2 Origin suffixe (https://127.0.0.1.evil.example) + cookie → REFUS 1008", async () => {
    const cookie = await loginCookie("admin", "secret");
    const { welcomed, code } = await observeHandshake(
      cookie,
      "https://127.0.0.1.evil.example",
    );
    // Match EXACT (originHost === domain), pas un endsWith laxiste.
    expect(welcomed).to.equal(false);
    expect(code).to.equal(1008);
  });

  it("O3 Origin userinfo (https://127.0.0.1@evil.example) + cookie → REFUS 1008", async () => {
    const cookie = await loginCookie("admin", "secret");
    const { welcomed, code } = await observeHandshake(
      cookie,
      "https://127.0.0.1@evil.example",
    );
    // WHATWG URL : hostname = evil.example (l'userinfo ne trompe pas la garde).
    expect(welcomed).to.equal(false);
    expect(code).to.equal(1008);
  });

  it("O4 Origin opaque (null) + cookie → REFUS 1008", async () => {
    const cookie = await loginCookie("admin", "secret");
    const { welcomed, code } = await observeHandshake(cookie, "null");
    // "null" n'est pas une URL valide → originHost null → jamais same-origin.
    expect(welcomed).to.equal(false);
    expect(code).to.equal(1008);
  });

  it("O5 contrôle positif : Origin same-origin (https://127.0.0.1:5152) + cookie → WELCOME", async () => {
    const cookie = await loginCookie("admin", "secret");
    const { welcomed } = await observeHandshake(
      cookie,
      "https://127.0.0.1:5152",
    );
    // hostname 127.0.0.1 === domain servi (port ignoré) → autorisé. Prouve que la
    // garde n'est pas un « refus tout » trivialement vert.
    expect(welcomed, "same-origin légitime doit passer").to.equal(true);
  });
});

describe("P6 RED-TEAM — identité figée à l'ALS, 0 re-trust par frame (requires server)", () => {
  it("B1 user + roles ROLE_ADMIN forgés dans les params api.request → 403 (params ignorés)", async () => {
    const cookie = await loginCookie("user", "secret");
    const hub = await connect(cookie);
    const reply = await hub.call({
      path: GUARDED,
      // Tentative d'élévation : la frame prétend être admin.
      user: "admin",
      roles: ["ROLE_ADMIN", "ROLE_SUPERADMIN"],
      identity: { userIdentifier: "admin", roles: ["ROLE_ADMIN"] },
    });
    hub.close();
    expect(
      reply.result,
      "aucun résultat : l'identité forgée est ignorée",
    ).to.equal(undefined);
    const data = reply.error?.data as { status?: number } | undefined;
    expect(
      data?.status,
      "garde lit l'ALS (user), pas le payload → 403",
    ).to.equal(403);
  });

  it("B2 user + token/sub forgés dans les params api.request → 403", async () => {
    const cookie = await loginCookie("user", "secret");
    const hub = await connect(cookie);
    const reply = await hub.call({
      path: GUARDED,
      token: "Bearer forged.admin.jwt",
      sub: "admin",
      scopes: ["admin"],
    });
    hub.close();
    expect(reply.result).to.equal(undefined);
    const data = reply.error?.data as { status?: number } | undefined;
    expect(
      data?.status,
      "token forgé dans la frame ne ré-authentifie pas",
    ).to.equal(403);
  });

  it("B0 contrôle positif : admin (ALS) → GRANT même sans champ d'identité dans la frame", async () => {
    const cookie = await loginCookie("admin", "secret");
    const hub = await connect(cookie);
    const reply = await hub.call({ path: GUARDED });
    hub.close();
    expect(reply.error, "admin légitime ne doit pas être refusé").to.equal(
      undefined,
    );
    expect(reply.result).to.deep.equal({ granted: true, identifier: "admin" });
  });
});

describe("P6 RED-TEAM — api.request confiné à la zone data plane (requires server)", () => {
  it("C1 path HORS data plane (/nodefony/test/index, pas /api/) → REFUS", async () => {
    const cookie = await loginCookie("admin", "secret");
    const hub = await connect(cookie);
    const reply = await hub.call({ path: "/nodefony/test/index" });
    hub.close();
    // Le verrou de frame n'autorise `api.request` que dans ^/nodefony/[^/]+/api(/|$).
    // /nodefony/test/index est une route HTTP réelle → ne doit PAS fuiter via le pont.
    expect(
      reply.result,
      "une route hors data plane ne doit pas être exécutée",
    ).to.equal(undefined);
    expect(reply.error, "path hors data plane → refusé").to.not.equal(
      undefined,
    );
  });

  it("C2 traversée '..' pour sortir de la zone (/nodefony/studio/api/../../test/index) → REFUS", async () => {
    const cookie = await loginCookie("admin", "secret");
    const hub = await connect(cookie);
    const reply = await hub.call({
      path: "/nodefony/studio/api/../../test/index",
    });
    hub.close();
    // Le préfixe matche la zone, mais la traversée ne doit pas atteindre une route
    // hors data plane (ni 200 d'/index).
    expect(
      reply.result,
      "la traversée ne doit pas exécuter une route hors plan",
    ).to.equal(undefined);
    expect(reply.error).to.not.equal(undefined);
  });

  it("C3 path malformé (number) → -32602 invalid params (avant toute résolution)", async () => {
    const cookie = await loginCookie("admin", "secret");
    const hub = await connect(cookie);
    const reply = await hub.call({ path: 123 });
    hub.close();
    expect(reply.result).to.equal(undefined);
    expect(reply.error?.code, "params.path non-string → -32602").to.equal(
      -32602,
    );
  });
});
