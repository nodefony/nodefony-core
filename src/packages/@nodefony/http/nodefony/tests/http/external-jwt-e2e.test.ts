/// <reference types="node" />
import { expect } from "chai";
import http from "node:http";
import https from "node:https";

/**
 * P6.9 — le chemin du **SUCCÈS** d'un jeton émis AILLEURS, joué de bout en bout
 * sur le serveur live (zones `test-self-external` et `test-foreign-audience`).
 *
 * Ce banc n'existait pas tant qu'il fallait un serveur d'autorisation tiers en
 * HTTPS pour l'écrire. Depuis que Nodefony publie ses métadonnées RFC 8414 et son
 * jeu de clés, **une application est découvrable — y compris par elle-même** : le
 * serveur émet un jeton par son flux à lui, puis le reçoit à une porte qui ne
 * connaît de lui QUE l'identifiant de son émetteur. Tout le reste, elle doit
 * aller le chercher.
 *
 * Ce qui est réellement exercé, et qu'aucun unitaire ne peut établir :
 *
 * 1. la **découverte** — la zone ne déclare aucun `jwksUri` ; le vérificateur ne
 *    peut donc réussir qu'en lisant `/.well-known/oauth-authorization-server`,
 *    puis le `jwks_uri` qu'il y trouve ;
 * 2. la **vérification** d'une vraie signature Ed25519 contre un jeu de clés
 *    obtenu par le réseau ;
 * 3. le **rattachement** du sujet du jeton à un compte local (politique
 *    `require`) — ce que le vérificateur, lui, refuse délibérément de faire ;
 * 4. l'**audience**, seule garde qui empêche de rejouer d'un service à l'autre le
 *    jeton d'un porteur parfaitement légitime (RFC 8707 §2) ;
 * 5. les **scopes**, du jeton jusqu'au voter.
 *
 * ⚠️ Décor. Le processus se joint lui-même en https : il doit faire confiance au
 * certificat de développement (`NODE_EXTRA_CA_CERTS`, posé par `start.sh`). Sans
 * cela le vérificateur ne peut pas joindre l'émetteur et la zone rend **503** —
 * verdict fidèle, mais qui n'éprouve pas ce banc. Les assertions le nomment.
 */

const HTTP = { hostname: "localhost", port: 5151 };
const TLS = { hostname: "localhost", port: 5152, rejectUnauthorized: false };
const TOKEN_URL = "/nodefony/security/api/token";
const METADATA = "/.well-known/oauth-authorization-server";
const WHOAMI = "/nodefony/test/self-external/whoami";
const SCOPED = "/nodefony/test/self-external/scoped/read";
const FOREIGN = "/nodefony/test/foreign-audience/whoami";
/** Émetteur de développement, déclaré par `nodefony.config.ts`. */
const ISSUER = "https://localhost:5152";
const ADMIN = { username: "admin", password: "secret" };
const TIMEOUT = 10_000;

type Res = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
};

function get(path: string, headers: Record<string, string> = {}): Promise<Res> {
  return new Promise((resolve, reject) => {
    const r = http.request({ ...HTTP, method: "GET", path, headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => (body += c));
      res.on("end", () =>
        resolve({ status: res.statusCode!, headers: res.headers, body }),
      );
    });
    r.on("error", reject);
    r.setTimeout(TIMEOUT, () => r.destroy(new Error("http timeout")));
    r.end();
  });
}

/** Grant par credential — sur le canal TLS, comme les autres bancs de jetons. */
function postJson(path: string, payload: unknown): Promise<Res> {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(payload));
    const r = https.request(
      {
        ...TLS,
        method: "POST",
        path,
        headers: {
          "content-type": "application/json",
          "content-length": String(data.length),
        },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c: string) => (body += c));
        res.on("end", () =>
          resolve({ status: res.statusCode!, headers: res.headers, body }),
        );
      },
    );
    r.on("error", reject);
    r.setTimeout(TIMEOUT, () => r.destroy(new Error("http timeout")));
    r.write(data);
    r.end();
  });
}

async function accessToken(scope?: string): Promise<string> {
  const res = await postJson(TOKEN_URL, {
    ...ADMIN,
    ...(scope ? { scope } : {}),
  });
  expect(res.status, "grant credential attendu 200").to.equal(200);
  const token = (JSON.parse(res.body) as { access_token?: unknown })
    .access_token;
  expect(token, "access_token attendu").to.be.a("string");
  return token as string;
}

/** Aide au diagnostic : un 503 ici désigne le décor, pas le code sous test. */
const decor =
  "503 = l'émetteur n'a pas pu être joint. Le serveur est-il lancé par " +
  "`start.sh` (NODE_EXTRA_CA_CERTS = CA de développement) ?";

describe("Jeton émis ICI, vérifié comme celui d'un TIERS (P6.9 e2e)", () => {
  beforeAll(async () => {
    // La zone exige l'audience `https://localhost:5152` parce que c'est ce que
    // cette application inscrit dans ses jetons. Si l'émetteur publié diffère
    // (`NF_JWT_ISSUER` posé), plus rien de ce banc n'a de sens : mieux vaut le
    // dire que de rendre six rouges dont aucun ne nomme la cause.
    const res = await get(METADATA);
    expect(
      res.status,
      "l'application ne publie pas ses métadonnées (rôle émetteur éteint ?)",
    ).to.equal(200);
    const doc = JSON.parse(res.body) as { issuer?: unknown };
    expect(
      doc.issuer,
      `banc écrit pour l'émetteur de développement ${ISSUER} — ` +
        `NF_JWT_ISSUER change le décor et l'audience exigée par la zone`,
    ).to.equal(ISSUER);
  });

  it("⭐ le jeton est vérifié et le sujet rattaché au compte LOCAL → 200", async () => {
    // LE test du lot. La porte ne possède pas la clé qui a signé ce jeton : pour
    // rendre 200, elle a dû découvrir le document d'émetteur, y lire `jwks_uri`,
    // tirer le jeu de clés, vérifier la signature, contrôler l'audience — puis
    // aller chercher le compte `admin`, ce que le vérificateur ne fait jamais.
    const res = await get(WHOAMI, {
      authorization: `Bearer ${await accessToken()}`,
    });
    expect(res.status, decor).to.equal(200);
    const body = JSON.parse(res.body) as {
      identifier?: unknown;
      roles?: unknown;
      external?: unknown;
    };
    expect(body.identifier).to.equal("admin");
    expect(body.external).to.equal(true);
    // Les rôles viennent du compte LOCAL, jamais du jeton : c'est la seconde
    // décision — celle de l'application — que la politique `require` préserve.
    expect(body.roles).to.be.an("array").that.is.not.empty;
  });

  it("🔴 le MÊME jeton sur une AUTRE ressource → 401 (RFC 8707 §2)", async () => {
    // Rien ne change sauf l'audience exigée par la zone : même émetteur de
    // confiance, même signature, même sujet, même fraîcheur. Sans ce refus, la
    // compromission d'un service donnerait accès à tous ceux qui partagent son
    // serveur d'autorisation.
    const token = await accessToken();
    expect(
      (await get(WHOAMI, { authorization: `Bearer ${token}` })).status,
      decor,
    ).to.equal(200);
    const res = await get(FOREIGN, { authorization: `Bearer ${token}` });
    expect(res.status).to.equal(401);
  });

  it("les scopes du jeton traversent jusqu'au voter — accordé → 200", async () => {
    const res = await get(SCOPED, {
      authorization: `Bearer ${await accessToken("selfext:read")}`,
    });
    expect(res.status, decor).to.equal(200);
  });

  it("scope absent → 403, jamais 401 : le porteur est authentifié, c'est le POUVOIR qui manque", async () => {
    // Un 401 ici enverrait un agent renouveler un jeton qui ne lui donnera
    // jamais ce droit — la boucle serait infinie et le journal muet sur la cause.
    const res = await get(SCOPED, {
      authorization: `Bearer ${await accessToken()}`,
    });
    expect(res.status).to.equal(403);
  });

  it("🔴 signature altérée → 401, et JAMAIS 503 : ici l'émetteur RÉPOND", async () => {
    // Le pendant exact du banc `.invalid`, qui ne peut montrer que la panne.
    // La distinction refus / panne n'a de valeur que si elle tranche dans les
    // DEUX sens : un jeton fautif face à un émetteur joignable est un refus.
    const [h, p] = (await accessToken()).split(".");
    const res = await get(WHOAMI, {
      authorization: `Bearer ${h}.${p}.${Buffer.from("pas-la-bonne-signature").toString("base64url")}`,
    });
    expect(res.status).to.equal(401);
  });

  it("sans jeton → 401 avec le défi RFC 7235", async () => {
    const res = await get(WHOAMI);
    expect(res.status).to.equal(401);
    expect(String(res.headers["www-authenticate"] ?? "")).to.match(/Bearer/i);
  });
});
