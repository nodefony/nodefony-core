/// <reference types="node" />
/**
 * Integration — une zone SANS REGISTRE n'ouvre ni ne reprend de session.
 * Requires: server running on 5152 (https). Start: /start-server
 *
 * `stateless: true` promet, dans sa description de configuration et dans la
 * console d'administration, que « la session est ignorée même si un cookie est
 * présent ». Rien ne l'appliquait : le drapeau était validé, stocké, affiché —
 * et lu par aucun code. Un cookie entrant suffisait à faire reprendre une
 * session sur une zone déclarée sans registre, à la RÉÉCRIRE quand son
 * identifiant n'était plus connu, et à renvoyer un `Set-Cookie` — jusque dans
 * une réponse 401.
 *
 * Le décor est celui du dépôt : la zone `test-api` (`^/nodefony/test/m2m`,
 * `stateless: true`, `src/modules/test/nodefony/config/config.ts:46-52`) et la
 * zone `test-secure` (`^/nodefony/test/secure`, à registre) — la seconde est le
 * TÉMOIN, sans lequel ce banc passerait aussi bien sur un serveur où plus
 * aucune session ne fonctionne.
 *
 * https://5152 : le cookie de session BFF (`__Host-`) exige un contexte sécurisé.
 */
import { expect } from "chai";
import https from "node:https";

const BASE = { hostname: "127.0.0.1", port: 5152, rejectUnauthorized: false };
const LOGIN = "/nodefony/security/api/auth/login";
const M2M = "/nodefony/test/m2m/whoami";
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

function setCookiesOf(res: Res): string[] {
  const raw = res.headers["set-cookie"];
  if (Array.isArray(raw)) return raw;
  return typeof raw === "string" ? [raw] : [];
}

async function sessionCookie(): Promise<string> {
  const res = await request(
    "POST",
    LOGIN,
    {},
    { username: "user", password: "secret" },
  );
  expect(res.status, "login").to.equal(200);
  const cookie = setCookiesOf(res)[0]?.split(";")[0];
  expect(cookie, "le login pose bien un cookie de session").to.be.a("string");
  return cookie!;
}

describe("Zone stateless — la session y est ignorée", () => {
  it("TÉMOIN — sur une zone à REGISTRE, le cookie est bien la preuve d'identité", async () => {
    // Sans ce cas, tout ce fichier resterait vert sur un serveur où plus
    // aucune session ne marche : « pas de session » ne prouve rien tout seul.
    const cookie = await sessionCookie();
    const res = await get("/nodefony/test/secure/whoami", { cookie });
    expect(res.status, "la zone à registre authentifie par le cookie").to.equal(
      200,
    );
  });

  // ⚠️ Vert AVEC ET SANS la garde : la zone `test-api` ne liste pas `session`
  // parmi ses authentificateurs, donc le cookie n'y a jamais authentifié. Ce cas
  // est une NON-RÉGRESSION, pas une preuve — la garde du boot
  // (`SessionAuthenticator.validateArea`) est ce qui interdit la combinaison, et
  // c'est `statelessArea.test.ts` qui l'éprouve.
  it("un cookie de session VALIDE n'authentifie pas sur une zone stateless", async () => {
    const cookie = await sessionCookie();
    const res = await get(M2M, { cookie });
    expect(res.status, "la session ne vaut pas preuve ici").to.equal(401);
  });

  it("🔴 un cookie INCONNU ne fait renvoyer aucun `Set-Cookie`", async () => {
    // Le cas qui écrivait dans le stockage de sessions : identifiant inconnu →
    // invalidation → création → cookie régénéré, sur une zone déclarée sans
    // registre, et jusque dans la réponse d'échec.
    const res = await get(M2M, {
      cookie: "__Host-nodefony=inconnu-fabrique-de-toutes-pieces",
    });
    expect(res.status).to.equal(401);
    expect(
      setCookiesOf(res),
      "une zone sans registre ne pose pas de cookie de session",
    ).to.deep.equal([]);
  });

  it("un appel SANS cookie se comporte comme avant — 401 nu, aucun cookie", async () => {
    const res = await get(M2M);
    expect(res.status).to.equal(401);
    expect(setCookiesOf(res)).to.deep.equal([]);
  });
});
