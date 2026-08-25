/// <reference types="node" />
/**
 * Integration — P6 J3b Étape 3 : VERROU WS du data plane (cross-brique).
 * Requires: server running on 5152 (wss). Start: /start-server
 *
 * Preuve END-TO-END que le pont `api.request` traverse TOUTES les briques avec
 * la sécurité active — c'est LE test qui compte pour un pont inter-modules :
 *   login (security)            → cookie de session opaque (http)
 *   → handshake WS firewall     (security sur le pipeline http)
 *   → FirewallRealtimeAuthenticator (security, lit l'identité résolue dans l'ALS)
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
import { randomUUID } from "node:crypto";
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

/** Identité annoncée dans le `realtime:welcome` (L2 — vue « sur soi »). */
type WelcomeIdentity = {
  type: string;
  authenticated: boolean;
  userIdentifier: string;
  roles: string[];
  scopes: string[];
};
type Welcome = {
  channels: string[];
  methods: string[];
  identity: WelcomeIdentity;
};

/** Connecte au hub (cookie optionnel) → bufferise welcome + appaire par id. */
function hubConnect(cookie: string | null): Promise<{
  welcome: Welcome;
  request: (path: string) => Promise<JsonRpcReply>;
  mutate: (
    path: string,
    init: { method: string; body?: unknown; idempotencyKey?: string },
  ) => Promise<JsonRpcReply>;
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
    ws.on("close", (code: number, raison: Buffer) => {
      clearTimeout(timer);
      // La RAISON, pas seulement le code. Un `1008` (Policy Violation) nu ne dit
      // pas QUI a refusé ni pourquoi — session absente, zone du firewall, origine,
      // compte inexistant : le diagnostic part alors au hasard. Le serveur envoie
      // une raison ; ne pas la lire, c'est jeter la seule chose utile.
      const motif = raison.length
        ? ` « ${raison.toString()} »`
        : " (sans raison)";
      reject(
        new Error(
          `le serveur a FERMÉ la connexion avant le welcome — code ${code}${motif}` +
            (cookie ? "" : " · aucun cookie n'était présenté"),
        ),
      );
    });
    ws.on("message", (data: Buffer) => {
      const frame = JSON.parse(String(data)) as Record<string, unknown>;
      if (frame.method === "realtime:welcome") {
        clearTimeout(timer);
        ws.removeAllListeners("close");
        const invoke = (params: Record<string, unknown>) =>
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
          });
        resolve({
          welcome: frame.params as Welcome,
          request: (path: string) => invoke({ path }),
          mutate: (path, init) =>
            invoke({
              path,
              method: init.method,
              body: init.body,
              idempotencyKey: init.idempotencyKey,
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

/**
 * Observe un handshake attendu REFUSÉ : `refused=true` si fermé sans welcome, +
 * le `code` de fermeture WS (doit être 1008 Policy Violation → le RealtimeClient
 * n'essaie PAS de reconnecter ; 1011 relancerait une boucle de reco).
 */
function expectRefused(
  cookie: string | null,
): Promise<{ refused: boolean; code: number }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(HUB_URL, {
      rejectUnauthorized: false,
      headers: cookie ? { cookie } : {},
    });
    let welcomed = false;
    let settled = false;
    const done = (refused: boolean, code = 0) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* déjà fermé */
      }
      resolve({ refused, code });
    };
    const timer = setTimeout(() => done(false), TIMEOUT); // pas de close → pas refusé
    ws.on("message", (data: Buffer) => {
      const frame = JSON.parse(String(data)) as Record<string, unknown>;
      if (frame.method === "realtime:welcome") {
        welcomed = true;
        done(false); // welcome reçu = PAS refusé
      }
    });
    ws.on("close", (code: number) => done(!welcomed, code));
    ws.on("error", () => {
      /* le refus peut surgir en error avant close — on attend le close */
    });
  });
}

describe("P6 J3b Étape 3 — verrou WS data plane (requires server)", () => {
  it("handshake ANONYME (sans cookie) → REFUSÉ en close 1008 (Policy, pas de reco)", async () => {
    const { refused, code } = await expectRefused(null);
    expect(refused, "anonyme ne reçoit jamais le welcome").to.equal(true);
    // 1008 (≠ 1011) : un refus d'auth est une violation de POLITIQUE → le
    // RealtimeClient abandonne au lieu de reconnecter en boucle (régression J3b
    // qui bloquait la Studio au chargement anonyme).
    expect(code).to.equal(1008);
  });

  it("HTTP data plane gaté : GET /nodefony/kernel/api/modules sans cookie → 401", async () => {
    const res = await get("/nodefony/kernel/api/modules");
    expect(res.status).to.equal(401);
  });

  it("LIVENESS public : GET /nodefony/studio/api/{health,info} sans cookie → 200 (bypassFirewall)", async () => {
    // Régression : le flux de login pingue `/health` AVANT l'auth → DOIT être
    // public (sinon 401 → login impossible). Convention liveness (k8s/monitoring).
    // Les VRAIES données data plane (modules ci-dessus) restent gatées (401).
    const health = await get("/nodefony/studio/api/health");
    expect(health.status, "/health doit être public").to.equal(200);
    const info = await get("/nodefony/studio/api/info");
    expect(info.status, "/info doit être public").to.equal(200);
  });

  it("handshake AUTHENTIFIÉ (cookie) → welcome + api.request annoncé + identité résolue (L2)", async () => {
    const cookie = await loginCookie("admin", "secret");
    const hub = await hubConnect(cookie);
    expect(hub.welcome.methods).to.include("api.request");
    // L2 — le welcome porte l'identité RÉSOLUE par le firewall
    // (FirewallRealtimeAuthenticator → UserRealtimeToken) : preuve END-TO-END que
    // security → serveur → client transmet l'identité (pas de route /auth/me).
    // type "session" = UserRealtimeToken (BFF cookie opaque).
    const id = hub.welcome.identity;
    expect(id.authenticated, "WS authentifié → identité authentifiée").to.equal(
      true,
    );
    expect(id.type).to.equal("session");
    expect(id.userIdentifier, "userIdentifier non vide").to.be.a("string").and
      .not.empty;
    expect(id.roles, "roles non vide").to.be.an("array").that.is.not.empty;
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

/**
 * P6 J8 — la garde `@IsGranted` (Resolver) s'applique AUSSI côté WebSocket via
 * `api.request` : « 1 garde = N transports ». Symétrique de la preuve HTTP J7
 * (`securityGuard.integration.test.ts` : admin 200 / user 403 / anon 401).
 *
 * Route gardée : `/nodefony/test/api/admin-guarded` (`@IsGranted("ROLE_ADMIN")`
 * + `@CurrentUser`, WS-invocable). Le token du peer (UserRealtimeToken résolu au
 * handshake) est posé dans l'ALS du message par J8 → la garde le lit. L'anonyme
 * est déjà refusé AU HANDSHAKE (1008, cf le 1ᵉʳ test ci-dessus) = défense en
 * profondeur (verrou de zone J3b PUIS garde RBAC J7).
 */
describe("P6 J8 — garde @IsGranted via api.request (requires server)", () => {
  const GUARDED = "/nodefony/test/api/admin-guarded";

  it("admin (ROLE_ADMIN) → GRANT : { granted:true, identifier } + @CurrentUser WS", async () => {
    const cookie = await loginCookie("admin", "secret");
    const hub = await hubConnect(cookie);
    const reply = await hub.request(GUARDED);
    hub.close();
    expect(reply.error, "admin ne doit pas être refusé").to.equal(undefined);
    // @CurrentUser injecte l'IUser de l'ALS WS (posé par J8 via getAttribute).
    expect(reply.result).to.deep.equal({
      granted: true,
      identifier: "admin",
    });
  });

  it("user (ROLE_USER : authentifié mais SANS le rôle) → 403 exposé (pas un -32603 opaque)", async () => {
    const cookie = await loginCookie("user", "secret");
    const hub = await hubConnect(cookie);
    const reply = await hub.request(GUARDED);
    hub.close();
    expect(reply.result, "user ne doit obtenir aucun résultat").to.equal(
      undefined,
    );
    expect(
      reply.error,
      "user authentifié mais non autorisé → refus",
    ).to.not.equal(undefined);
    // La garde mappe le 403 en RpcError(data.status) — symétrie d'un fetch qui
    // expose son statut. PROUVE que J8 distingue 403 (autz) d'un -32603 internal
    // error opaque (le 403 n'est pas une erreur serveur : autz ≠ authn).
    const data = reply.error?.data as { status?: number } | undefined;
    expect(data?.status, "statut d'autorisation exposé").to.equal(403);
  });
});

/**
 * P6.8 — MUTATIONS par la socket (idempotentes). Preuve END-TO-END sur le
 * serveur réel : `POST /nodefony/test/api/idem-probe` (mutation admin à compteur
 * OBSERVABLE) via le pont `api.request`, avec `Idempotency-Key`. Couvre dédup
 * (rejeu = réponse mémorisée), verrou in-flight (409), scope par identité
 * (anti-IDOR du cache), clé obligatoire en WS (400), désambiguïsation de méthode
 * (405), et l'équivalence WS ≡ HTTP.
 *
 * `idem-probe` est `public:true` (pas de rôle requis) → testable par `admin` ET
 * `user`, tous deux authentifiés par le firewall.
 */
const PROBE = "/nodefony/test/api/idem-probe";

/** Compteur de la réponse (déballe `{result}` du wrap HttpKernel si présent). */
function countOf(payload: unknown): number {
  let p = payload;
  if (p && typeof p === "object" && "result" in p) {
    p = (p as { result: unknown }).result;
  }
  return (p as { count?: number } | null)?.count ?? -1;
}

/** Statut effectif d'une réponse de pont (200 si succès, sinon `error.data.status`). */
function statusOf(reply: JsonRpcReply): number {
  if (!reply.error) return 200;
  return (reply.error.data as { status?: number } | undefined)?.status ?? -1;
}

describe("P6.8 — mutations socket idempotentes (requires server)", () => {
  it("mutation WS (POST + clé) → exécute + identité résolue + corps transporté", async () => {
    const cookie = await loginCookie("admin", "secret");
    const hub = await hubConnect(cookie);
    const reply = await hub.mutate(PROBE, {
      method: "POST",
      body: { a: 1 },
      idempotencyKey: randomUUID(),
    });
    hub.close();
    expect(reply.error, "mutation autorisée ne doit pas être refusée").to.equal(
      undefined,
    );
    const r = reply.result as {
      count: number;
      echo: unknown;
      identity: string;
    };
    expect(r.count, "compteur incrémenté").to.be.a("number");
    expect(r.echo, "corps de la frame transporté par l'ALS").to.deep.equal({
      a: 1,
    });
    expect(r.identity, "identité du token résolue").to.equal("admin");
  });

  it("REJEU même clé → réponse MÉMORISÉE (compteur stable = anti double-effet)", async () => {
    const cookie = await loginCookie("admin", "secret");
    const hub = await hubConnect(cookie);
    const key = randomUUID();
    const first = await hub.mutate(PROBE, {
      method: "POST",
      idempotencyKey: key,
    });
    const replay = await hub.mutate(PROBE, {
      method: "POST",
      idempotencyKey: key,
    });
    hub.close();
    expect(countOf(first.result)).to.be.greaterThan(0);
    // Le rejeu renvoie EXACTEMENT la réponse mémorisée → le compteur n'avance pas.
    expect(countOf(replay.result), "rejeu = même compteur").to.equal(
      countOf(first.result),
    );
  });

  it("clé DIFFÉRENTE → ré-exécute (nouvelle intention → le compteur avance)", async () => {
    const cookie = await loginCookie("admin", "secret");
    const hub = await hubConnect(cookie);
    const a = await hub.mutate(PROBE, {
      method: "POST",
      idempotencyKey: randomUUID(),
    });
    const b = await hub.mutate(PROBE, {
      method: "POST",
      idempotencyKey: randomUUID(),
    });
    hub.close();
    expect(countOf(b.result)).to.equal(countOf(a.result) + 1);
  });

  it("même clé, PAYLOAD DIFFÉRENT → 422 (draft §2.7 : réutilisation interdite)", async () => {
    const cookie = await loginCookie("admin", "secret");
    const hub = await hubConnect(cookie);
    const key = randomUUID();
    const first = await hub.mutate(PROBE, {
      method: "POST",
      body: { a: 1 },
      idempotencyKey: key,
    });
    // MÊME clé, corps DIFFÉRENT → le fingerprint diffère → réutilisation refusée.
    const reuse = await hub.mutate(PROBE, {
      method: "POST",
      body: { a: 2 },
      idempotencyKey: key,
    });
    hub.close();
    expect(first.error, "1ʳᵉ requête doit réussir").to.equal(undefined);
    expect(reuse.result).to.equal(undefined);
    expect(statusOf(reuse)).to.equal(422);
  });

  it("clé ABSENTE sur une mutation WS → 400 (la socket rejoue : garde-fou requis)", async () => {
    const cookie = await loginCookie("admin", "secret");
    const hub = await hubConnect(cookie);
    const reply = await hub.mutate(PROBE, { method: "POST" }); // pas de clé
    hub.close();
    expect(reply.result).to.equal(undefined);
    expect(statusOf(reply)).to.equal(400);
  });

  it("clé ABUSIVE (>255 car) → 400 (anti-DoS : ne gonfle pas le cache borné)", async () => {
    const cookie = await loginCookie("admin", "secret");
    const hub = await hubConnect(cookie);
    const reply = await hub.mutate(PROBE, {
      method: "POST",
      idempotencyKey: "x".repeat(300),
    });
    hub.close();
    expect(reply.result).to.equal(undefined);
    expect(statusOf(reply)).to.equal(400); // clé trop longue = traitée comme absente
  });

  it("IN-FLIGHT : deux mutations concurrentes même clé → un 200, un 409", async () => {
    const cookie = await loginCookie("admin", "secret");
    const hub = await hubConnect(cookie);
    const key = randomUUID();
    // `delayMs` ouvre la fenêtre : la 2ᵉ frame arrive pendant que la 1ʳᵉ est
    // in-flight → le store renvoie 409 (anti double-exécution concurrente).
    const [r1, r2] = await Promise.all([
      hub.mutate(PROBE, {
        method: "POST",
        body: { delayMs: 500 },
        idempotencyKey: key,
      }),
      hub.mutate(PROBE, {
        method: "POST",
        body: { delayMs: 500 },
        idempotencyKey: key,
      }),
    ]);
    hub.close();
    expect([statusOf(r1), statusOf(r2)]).to.have.members([200, 409]);
  });

  it("SCOPE par identité : `user` rejouant la clé d'`admin` ne lit PAS sa réponse", async () => {
    const adminCookie = await loginCookie("admin", "secret");
    const userCookie = await loginCookie("user", "secret");
    const key = randomUUID();
    const adminHub = await hubConnect(adminCookie);
    const adminReply = await adminHub.mutate(PROBE, {
      method: "POST",
      idempotencyKey: key,
    });
    adminHub.close();
    const userHub = await hubConnect(userCookie);
    const userReply = await userHub.mutate(PROBE, {
      method: "POST",
      idempotencyKey: key,
    });
    userHub.close();
    // Même clé client, identités distinctes → DEUX exécutions distinctes : chacune
    // voit SON identité, jamais la réponse mémorisée de l'autre (anti-IDOR cache).
    expect((adminReply.result as { identity: string }).identity).to.equal(
      "admin",
    );
    expect((userReply.result as { identity: string }).identity).to.equal(
      "user",
    );
    expect(countOf(userReply.result)).to.be.greaterThan(
      countOf(adminReply.result),
    );
  });

  it("désambiguïsation de méthode : DELETE sur une route POST-only → 405", async () => {
    const cookie = await loginCookie("admin", "secret");
    const hub = await hubConnect(cookie);
    const reply = await hub.mutate(PROBE, {
      method: "DELETE",
      idempotencyKey: randomUUID(),
    });
    hub.close();
    expect(reply.result).to.equal(undefined);
    expect(statusOf(reply)).to.equal(405);
  });

  it("mutation HTTP (en-tête Idempotency-Key honoré) ≡ même action", async () => {
    const cookie = await loginCookie("admin", "secret");
    const res = await request(
      PROBE,
      "POST",
      { cookie, "idempotency-key": randomUUID() },
      { a: 2 },
    );
    expect(res.status).to.equal(200);
    expect(countOf(res.body)).to.be.greaterThan(0);
  });

  it("REJEU HTTP même Idempotency-Key → réponse mémorisée (compteur stable)", async () => {
    const cookie = await loginCookie("admin", "secret");
    const key = randomUUID();
    const first = await request(
      PROBE,
      "POST",
      { cookie, "idempotency-key": key },
      { a: 3 },
    );
    const replay = await request(
      PROBE,
      "POST",
      { cookie, "idempotency-key": key },
      { a: 3 },
    );
    expect(countOf(first.body)).to.be.greaterThan(0);
    expect(countOf(replay.body)).to.equal(countOf(first.body));
  });

  it("mutation HTTP SANS clé → exécute (rétro-compat : HTTP ne rejoue pas seul)", async () => {
    const cookie = await loginCookie("admin", "secret");
    const res = await request(PROBE, "POST", { cookie }, { a: 4 });
    expect(res.status).to.equal(200);
    expect(countOf(res.body)).to.be.greaterThan(0);
  });
});
