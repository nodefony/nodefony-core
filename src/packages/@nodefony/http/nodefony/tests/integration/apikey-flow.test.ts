/// <reference types="node" />
/**
 * Integration — P6.12 : clés API personnelles (PAT) bout-en-bout.
 * Requires: server running on 5152 (https). Start: /start-server
 *
 * Preuve END-TO-END à travers TOUTES les briques (firewall + zone `test-api` +
 * ApiKeyAuthenticator + ApiKeyService + store + ApiKeyController), avec les
 * fixtures dev (`admin`/`user` : `secret`) :
 *   POST /auth/login (session BFF)  → cookie opaque
 *   POST /api/keys (cookie)         → 201 { token (clair, 1×), id, … }
 *   GET  /test/m2m/whoami (Bearer)  → 200 { identifier } (clé authentifie)
 *   DELETE /api/keys/{id} (cookie)  → révoquée → Bearer ensuite = 401
 *
 * Matrice d'attaques sur le wire : pas de Bearer → 401 · clé forgée → 401 ·
 * révoquée → 401 · création anonyme → 401 · IDOR (clé d'autrui) → 404 · secret
 * jamais ré-exposé au listing · coexistence JWT + PAT dans la même zone.
 *
 * https://5152 : le cookie de session BFF (`__Host-`) exige un contexte sécurisé.
 */
import { expect } from "chai";
import https from "node:https";

const BASE = { hostname: "127.0.0.1", port: 5152, rejectUnauthorized: false };
const LOGIN = "/nodefony/security/api/auth/login";
const KEYS = "/nodefony/security/api/keys";
const WHOAMI = "/nodefony/test/m2m/whoami";
const TOKEN = "/nodefony/security/api/token";
const TIMEOUT = 10_000;

type Res = { status: number; headers: Record<string, unknown>; body: unknown };

function request(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: unknown,
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const h: Record<string, string> = { ...headers };
    if (payload !== undefined) {
      h["content-type"] = "application/json";
      h["content-length"] = String(Buffer.byteLength(payload));
    }
    const req = https.request({ ...BASE, path, method, headers: h }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString();
        let parsed: unknown = raw;
        try {
          parsed = JSON.parse(raw);
        } catch {
          /* texte brut / vide */
        }
        resolve({
          status: res.statusCode!,
          headers: res.headers as Record<string, unknown>,
          body: parsed,
        });
      });
    });
    req.on("error", reject);
    req.setTimeout(TIMEOUT, () => req.destroy(new Error("http timeout")));
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

const get = (p: string, h: Record<string, string> = {}) => request("GET", p, h);
const post = (p: string, h: Record<string, string>, b?: unknown) =>
  request("POST", p, h, b);
const del = (p: string, h: Record<string, string>) => request("DELETE", p, h);

function sessionCookieOf(res: Res): string | null {
  const setCookie = res.headers["set-cookie"];
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (typeof first !== "string") return null;
  return first.split(";")[0] ?? null;
}

async function loginAs(username: string, password: string): Promise<string> {
  const res = await post(LOGIN, {}, { username, password });
  expect(res.status, `login ${username}`).to.equal(200);
  const cookie = sessionCookieOf(res);
  expect(cookie, "login pose un cookie de session").to.be.a("string");
  return cookie!;
}

type Created = { id: string; token: string; prefix: string; name: string };

async function createKey(
  cookie: string,
  body: Record<string, unknown>,
): Promise<Created> {
  const res = await post(KEYS, { cookie }, body);
  expect(res.status, "création de clé → 201").to.equal(201);
  return res.body as Created;
}

/**
 * Ardoise propre : révoque les PAT que les runs précédents ont laissés au
 * porteur. Sans ça le banc n'est jouable qu'UNE fois — le store de jetons est
 * persistant en dev, les clés s'accumulent, et à `maxPerSubject` la création
 * répond `409` : la suite échoue sur un défaut du banc, pas du code.
 */
async function revokeExistingKeys(cookie: string): Promise<void> {
  const res = await get(KEYS, { cookie });
  if (res.status !== 200) return; // service indisponible → les tests le diront
  const body = res.body as { keys?: Array<{ id?: unknown }> };
  for (const key of body.keys ?? []) {
    if (typeof key.id === "string") await del(`${KEYS}/${key.id}`, { cookie });
  }
}

describe("API Keys (PAT) — P6.12 e2e", () => {
  beforeAll(async () => {
    for (const user of ["admin", "user"]) {
      await revokeExistingKeys(await loginAs(user, "secret"));
    }
  });

  it("1. login → create → la clé authentifie /m2m/whoami (200, identité = porteur)", async () => {
    const cookie = await loginAs("admin", "secret");
    const created = await createKey(cookie, {
      name: "ci-deploy",
      scopes: ["orders:read"],
    });
    expect(created.token).to.be.a("string").and.match(/^nf_/);
    expect(created.prefix).to.match(/^nf_/);

    const who = await get(WHOAMI, { authorization: `Bearer ${created.token}` });
    expect(who.status, "clé valide → 200").to.equal(200);
    expect((who.body as { identifier: string }).identifier).to.equal("admin");
  });

  it("2. listing : la clé apparaît SANS secret ni hash", async () => {
    const cookie = await loginAs("admin", "secret");
    const created = await createKey(cookie, { name: "listed" });
    const list = await get(KEYS, { cookie });
    expect(list.status).to.equal(200);
    const keys = (list.body as { keys: Array<Record<string, unknown>> }).keys;
    const found = keys.find((k) => k.id === created.id);
    expect(found, "la clé créée est listée").to.exist;
    expect(found).to.not.have.property("secretHash");
    expect(found).to.not.have.property("token");
  });

  it("3. révocation → la clé ne passe plus (401)", async () => {
    const cookie = await loginAs("admin", "secret");
    const created = await createKey(cookie, { name: "revoke-me" });
    const auth = { authorization: `Bearer ${created.token}` };
    expect((await get(WHOAMI, auth)).status, "avant révocation").to.equal(200);

    const rev = await del(`${KEYS}/${created.id}`, { cookie });
    expect(rev.status, "révocation → 200").to.equal(200);
    expect((await get(WHOAMI, auth)).status, "après révocation").to.equal(401);
  });

  it("4. attaque : pas de Bearer → 401", async () => {
    expect((await get(WHOAMI)).status).to.equal(401);
  });

  it("5. attaque : clé forgée / CRC invalide → 401", async () => {
    const res = await get(WHOAMI, {
      authorization:
        "Bearer nf_deadbeefAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    });
    expect(res.status).to.equal(401);
  });

  it("6. attaque : création anonyme (sans session) → 401", async () => {
    expect((await post(KEYS, {}, { name: "anon" })).status).to.equal(401);
  });

  it("7. attaque IDOR : un autre porteur ne voit ni ne révoque ma clé", async () => {
    const adminCookie = await loginAs("admin", "secret");
    const created = await createKey(adminCookie, { name: "admin-private" });

    const userCookie = await loginAs("user", "secret");
    const userList = await get(KEYS, { cookie: userCookie });
    const leaked = (userList.body as { keys: Array<{ id: string }> }).keys.find(
      (k) => k.id === created.id,
    );
    expect(leaked, "la clé admin ne fuit pas chez user").to.be.undefined;

    const rev = await del(`${KEYS}/${created.id}`, { cookie: userCookie });
    expect(
      rev.status,
      "révoquer la clé d'autrui → 404 (anti-énumération)",
    ).to.equal(404);

    // La clé admin est intacte.
    expect(
      (await get(WHOAMI, { authorization: `Bearer ${created.token}` })).status,
      "clé admin toujours valide",
    ).to.equal(200);
  });

  it("8. coexistence JWT + PAT dans la même zone (discriminés par forme)", async () => {
    // JWT (structure a.b.c) via le grant credential.
    const tok = await post(
      TOKEN,
      {},
      { username: "admin", password: "secret" },
    );
    expect(tok.status, "émission JWT").to.equal(200);
    const jwt = (tok.body as { access_token: string }).access_token;
    expect(
      (await get(WHOAMI, { authorization: `Bearer ${jwt}` })).status,
      "JWT accepté",
    ).to.equal(200);

    // PAT (préfixe nf_) sur la MÊME route.
    const cookie = await loginAs("admin", "secret");
    const created = await createKey(cookie, { name: "coexist" });
    expect(
      (await get(WHOAMI, { authorization: `Bearer ${created.token}` })).status,
      "PAT accepté",
    ).to.equal(200);
  });
});
