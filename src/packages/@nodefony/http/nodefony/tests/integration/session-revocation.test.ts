/// <reference types="node" />
/**
 * Integration — révocation de session (cycle de vie). Bug live 2026-06-21 :
 * « révoquer une session ne déconnecte pas ». Cause = l'AUTOSAVE de fin de
 * requête ré-écrivait la session que la révocation venait de détruire
 * (résurrection). Fix = pierre tombale storage (anti-résurrection).
 *
 * Prouve bout-en-bout, sur serveur live, les 3 chemins admin du dialog Studio
 * Sessions + le logout volontaire (sentinelle, déjà sain car il passe par
 * `session.destroy()`) :
 *   0. logout volontaire              → /me 401
 *   1. révoquer MA session (self)     → /me 401   ← LE bug
 *   2. révoquer la session d'un AUTRE → la victime tombe, l'admin reste
 *   3. déconnecter TOUT un user       → toutes 401 + count > 0
 *
 * Requires: server running on 5152 (https). Start: /start-server
 * Fixtures dev : admin/secret (ROLE_NODEFONY_ADMIN), user/secret (ROLE_USER).
 * https://5152 : le cookie de session BFF (`__Host-`) exige un contexte sécurisé.
 */
import { expect } from "chai";
import https from "node:https";

const BASE = { hostname: "127.0.0.1", port: 5152, rejectUnauthorized: false };
const LOGIN = "/nodefony/security/api/auth/login";
const LOGOUT = "/nodefony/security/api/auth/logout";
const ME = "/nodefony/security/api/auth/me";
const LIST = "/nodefony/http/api/sessions/list";
const revokeRefPath = (ref: string) =>
  `/nodefony/http/api/sessions/${encodeURIComponent(ref)}/revoke`;
const revokeUserPath = (id: string) =>
  `/nodefony/http/api/sessions/revoke-user/${encodeURIComponent(id)}`;
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
const post = (p: string, h: Record<string, string> = {}, b?: unknown) =>
  request("POST", p, h, b);

function sessionCookieOf(res: Res): string | null {
  const setCookie = res.headers["set-cookie"];
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (typeof first !== "string") return null;
  return first.split(";")[0] ?? null;
}

/** POST login (BFF) → cookie de session opaque. */
async function loginAs(username: string, password: string): Promise<string> {
  const res = await post(LOGIN, {}, { username, password });
  expect(res.status, `login ${username}`).to.equal(200);
  const cookie = sessionCookieOf(res);
  expect(cookie, "login pose un cookie de session").to.be.a("string");
  return cookie!;
}

/** Statut de /me pour un cookie : 200 = authentifié, 401 = anonyme. */
async function meStatus(cookie: string): Promise<number> {
  return (await get(ME, { cookie })).status;
}

/** Refs (HMAC public) des sessions d'un user — énumération admin (cookie admin). */
interface ISessionListItem {
  ref: string;
  ip: string | null;
  ua: string | null;
}

async function listAllSessions(
  adminCookie: string,
  user: string,
): Promise<ISessionListItem[]> {
  // TOUTES les pages, pas la première : le listing est paginé et l'ordre du
  // store peut être arbitraire (SCAN Redis, qui ne trie rien). Sur un serveur
  // qui porte déjà plus d'une page de sessions du même user (suite complète,
  // bancs), la session fraîche manque à la page 1 et le diff avant/après
  // conclut à tort « aucune session créée » — vécu : rouge probabiliste en
  // suite, vert isolé. Contrat de l'endpoint : backend à curseur (Redis) →
  // `nextCursor` (suivi via ?cursor=), backend offset (SQL/mémoire) → `total`.
  const byRef = new Map<string, ISessionListItem>();
  const limit = 100;
  let cursor: string | undefined;
  let offset = 0;
  for (let guard = 0; guard < 100; guard += 1) {
    const params = new URLSearchParams({ user, limit: String(limit) });
    if (cursor) params.set("cursor", cursor);
    else if (offset > 0) params.set("offset", String(offset));
    const res = await get(`${LIST}?${params.toString()}`, {
      cookie: adminCookie,
    });
    expect(res.status, "list sessions (admin)").to.equal(200);
    const page = res.body as {
      items?: ISessionListItem[];
      nextCursor?: string | null;
      total?: number;
    };
    const items = page.items ?? [];
    const sizeBefore = byRef.size;
    for (const it of items) byRef.set(it.ref, it);
    if (page.nextCursor) {
      cursor = page.nextCursor;
      continue;
    }
    if (page.nextCursor === null) break; // curseur épuisé (fin de SCAN)
    if (items.length === 0) break; // offset épuisé
    offset += items.length;
    if (page.total !== undefined && offset >= page.total) break;
    // Ni curseur ni progression : une page identique en boucle (backend qui
    // ignore l'offset) s'arrête ici plutôt que de tourner jusqu'au guard.
    if (byRef.size === sizeBefore) break;
  }
  return [...byRef.values()];
}

async function refsOf(adminCookie: string, user: string): Promise<string[]> {
  return (await listAllSessions(adminCookie, user)).map((i) => i.ref);
}

/**
 * Login + isolation déterministe de LA session créée : diff des refs avant/après
 * (le serveur dev peut porter d'autres sessions du même user). Renvoie le cookie
 * de la session fraîche et son ref public.
 */
async function loginAndIsolate(
  adminCookie: string,
  username: string,
  password: string,
): Promise<{ cookie: string; ref: string }> {
  const before = new Set(await refsOf(adminCookie, username));
  const cookie = await loginAs(username, password);
  const fresh = (await refsOf(adminCookie, username)).filter(
    (r) => !before.has(r),
  );
  expect(fresh.length, `1 nouvelle session ${username} isolée`).to.equal(1);
  return { cookie, ref: fresh[0]! };
}

describe("Révocation de session — cycle de vie (3 chemins admin + logout)", () => {
  // Sentinelle : le logout volontaire passe par `session.destroy()` (objet en
  // mémoire neutralisé) → déjà sain. Verrouille qu'il le reste.
  it("0. logout volontaire → /me 401 (sentinelle)", async () => {
    const cookie = await loginAs("user", "secret");
    expect(await meStatus(cookie), "loggé avant").to.equal(200);
    const out = await post(LOGOUT, { cookie });
    expect(out.status, "logout 200 (idempotent)").to.equal(200);
    expect(await meStatus(cookie), "déconnecté après logout").to.equal(401);
  });

  // LE bug : l'admin révoque SA PROPRE session. L'autosave de la requête de
  // révocation NE DOIT PAS la ressusciter.
  it("1. révoquer MA session (admin self) → /me 401", async () => {
    const viewer = await loginAs("admin", "secret"); // 2ᵉ session admin (lister)
    const { cookie, ref } = await loginAndIsolate(viewer, "admin", "secret");
    expect(await meStatus(cookie), "admin loggé avant").to.equal(200);
    const rev = await post(revokeRefPath(ref), { cookie }); // je révoque MA session
    expect(rev.status, "revoke 200").to.equal(200);
    expect(await meStatus(cookie), "MA session révoquée → 401").to.equal(401);
  });

  it("2. révoquer la session d'un AUTRE → la victime tombe, l'admin reste", async () => {
    const admin = await loginAs("admin", "secret");
    const { cookie: victim, ref } = await loginAndIsolate(
      admin,
      "user",
      "secret",
    );
    const rev = await post(revokeRefPath(ref), { cookie: admin });
    expect(rev.status).to.equal(200);
    expect(await meStatus(victim), "la victime est déconnectée").to.equal(401);
    expect(await meStatus(admin), "l'admin reste connecté").to.equal(200);
  });

  it("3. déconnecter TOUT un user (logout everywhere) → toutes 401 + count > 0", async () => {
    const u1 = await loginAs("user", "secret");
    const u2 = await loginAs("user", "secret");
    const admin = await loginAs("admin", "secret");
    const rev = await post(revokeUserPath("user"), { cookie: admin });
    expect(rev.status).to.equal(200);
    const count = (rev.body as { count?: number }).count ?? 0;
    expect(count, "≥ 2 sessions détruites").to.be.greaterThan(1);
    expect(await meStatus(u1), "session 1 coupée").to.equal(401);
    expect(await meStatus(u2), "session 2 coupée").to.equal(401);
    expect(await meStatus(admin), "l'admin reste connecté").to.equal(200);
  });
});

// ── PROVENANCE : ip + ua capturés à l'OUVERTURE de session (login) ────────────
// La console Sessions (Studio) affiche « ouverte depuis » : `authFlow.#openSession`
// pose `metaBag.ip`/`metaBag.ua` (proxy-aware) avant `session.save`, surfacés par
// `toSessionSummary` (déjà unit-testé). Ici la preuve WIRE : un login avec un
// User-Agent connu le retrouve dans `sessions/list`, + une ip non nulle (loopback).

// Garde le fix HttpAdminApi : le `cursor` entrant doit être TRANSMIS au store.
// Sans lui, un backend à curseur (SCAN Redis) repart du début à chaque appel et
// renvoie indéfiniment la même page avec le même `nextCursor` : la pagination
// boucle sans avancer (vécu : 31 pages identiques, listing jamais complet).
// Sur un backend à offset (SQL/mémoire), `nextCursor` est absent → sortie
// immédiate, le test reste inoffensif.
describe("Pagination à curseur du listing de sessions", () => {
  it("le curseur AVANCE et la pagination se TERMINE", async () => {
    const admin = await loginAs("admin", "secret");
    const seen = new Set<string>();
    let cursor: string | undefined;
    let pages = 0;
    // limit large : le nombre de pages d'un SCAN dépend du keyspace ENTIER du
    // store (un serveur de dev porte des centaines de sessions résiduelles) —
    // avec un limit de 5 le parcours légitime dépassait déjà 40 pages.
    for (; pages < 60; pages += 1) {
      const params = new URLSearchParams({ limit: "100" });
      if (cursor) params.set("cursor", cursor);
      const res = await get(`${LIST}?${params.toString()}`, { cookie: admin });
      expect(res.status, "list sessions (admin)").to.equal(200);
      const page = res.body as { nextCursor?: string | null };
      if (!page.nextCursor) break; // fin de scan, ou backend à offset
      expect(
        seen.has(page.nextCursor),
        `nextCursor "${page.nextCursor}" déjà vu — le cursor entrant est ignoré, la pagination boucle`,
      ).to.equal(false);
      seen.add(page.nextCursor);
      cursor = page.nextCursor;
    }
    expect(
      pages,
      "la pagination doit se terminer avant le garde-fou",
    ).to.be.below(60);
  });
});

describe("Provenance de session — ip/ua capturés au login (console Sessions)", () => {
  it("login avec un User-Agent connu → surfacé dans sessions/list (+ ip)", async () => {
    const admin = await loginAs("admin", "secret");
    const before = new Set(await refsOf(admin, "user"));
    const UA = "nodefony-provenance-probe/1.0";
    // node:https n'émet PAS de User-Agent par défaut → on l'impose explicitement
    // pour prouver la capture (sinon `ua` serait légitimement null).
    const res = await post(
      LOGIN,
      { "user-agent": UA },
      { username: "user", password: "secret" },
    );
    expect(res.status, "login user").to.equal(200);
    const cookie = sessionCookieOf(res);
    try {
      const items = await listAllSessions(admin, "user");
      const fresh = items.filter((i) => !before.has(i.ref));
      expect(fresh.length, "1 session fraîche isolée").to.equal(1);
      const s = fresh[0]!;
      expect(s.ip, "ip capturée au login (loopback, non null)").to.be.a(
        "string",
      );
      expect(s.ua, "ua = User-Agent envoyé au login").to.equal(UA);
    } finally {
      if (cookie) await post(LOGOUT, { cookie });
    }
  });
});
