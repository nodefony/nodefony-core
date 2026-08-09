/// <reference types="node" />
import { expect } from "chai";
import http from "node:http";

/**
 * Rôle ÉMETTEUR (RFC 8414) — banc d'INTÉGRATION RÉEL contre le serveur live
 * (port 5151).
 *
 * Ce banc existe pour ce qu'aucun unitaire ne peut établir : les deux documents
 * sont-ils SERVIS, au chemin exact qu'un tiers va construire, et sans que le
 * pare-feu s'interpose ? Trois frontières séparent la décision de la réponse —
 * `TokenService.publishedIssuer()`, le montage conditionnel dans le module
 * framework, et `bypassFirewall` sur les routes. Chacune peut annuler les deux
 * autres en silence : une route non montée rend `404`, une route dans l'aire du
 * pare-feu rend `401`, et les deux ressemblent à « cette application ne publie
 * rien ».
 *
 * Décor : l'application de développement déclare `security.jwt.issuer` =
 * `https://localhost:5152` (cf `nodefony.config.ts`). Le document est donc servi
 * à la racine des chemins bien connus, et il porte cette URL — pas celle par
 * laquelle on l'interroge, ce qui est précisément la garde à vérifier.
 */

const BASE = { hostname: "localhost", port: 5151 };
const METADATA = "/.well-known/oauth-authorization-server";
const JWKS = "/.well-known/jwks.json";
const ISSUER = "https://localhost:5152";

type Res = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
};

function get(path: string, headers: Record<string, string> = {}): Promise<Res> {
  return new Promise((resolve, reject) => {
    const r = http.request({ ...BASE, method: "GET", path, headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => (body += c));
      res.on("end", () =>
        resolve({ status: res.statusCode!, headers: res.headers, body }),
      );
    });
    r.on("error", reject);
    r.end();
  });
}

describe("Émetteur — métadonnées RFC 8414", () => {
  it("le document est SERVI, sans authentification", async () => {
    // `bypassFirewall` : un JWKS derrière une authentification serait un
    // non-sens — il sert à vérifier les jetons de qui n'est pas encore
    // authentifié. Un 401 ici veut dire que la route est tombée dans l'aire du
    // pare-feu.
    const res = await get(METADATA);
    expect(res.status).to.equal(200);
  });

  it("🔴 il déclare l'émetteur CONFIGURÉ, jamais l'hôte par lequel on entre", async () => {
    // LA garde du lot. On entre par `http://localhost:5151` et le document
    // répond `https://localhost:5152` — l'identité publiée vient de la
    // configuration, pas de la requête. Dérivée du `Host`, elle ferait servir
    // par le VRAI serveur un `jwks_uri` choisi par l'appelant, et empoisonnerait
    // tout cache mutualisé.
    const doc = JSON.parse((await get(METADATA)).body) as Record<
      string,
      unknown
    >;
    expect(doc.issuer).to.equal(ISSUER);
    expect(String(doc.jwks_uri)).to.equal(`${ISSUER}${JWKS}`);
  });

  it("un `Host` inconnu n'atteint même pas la route (421 en amont)", async () => {
    // Défense en profondeur : la garde de domaine du kernel refuse avant le
    // routage. Ce test la CONSTATE pour qu'un relâchement futur se voie ici.
    const res = await get(METADATA, { host: "attaquant.example" });
    expect(res.status).to.equal(421);
  });

  it("il ANNONCE l'absence de flux d'autorisation au lieu de laisser jouer les défauts", async () => {
    // `grant_types_supported` omis vaudrait ["authorization_code","implicit"]
    // (RFC 8414 §2) — deux flux que cette application n'offre pas.
    const doc = JSON.parse((await get(METADATA)).body) as Record<
      string,
      unknown
    >;
    expect(doc.response_types_supported).to.deep.equal([]);
    expect(doc.grant_types_supported).to.deep.equal([]);
  });

  it("il se met en cache — sinon un client conforme le redemande à chaque connexion", async () => {
    const res = await get(METADATA);
    expect(String(res.headers["cache-control"] ?? "")).to.match(/max-age=/);
  });
});

describe("Émetteur — jeu de clés publiques", () => {
  it("le JWKS est servi, sans authentification", async () => {
    const res = await get(JWKS);
    expect(res.status).to.equal(200);
  });

  it("🔴 il ne porte QUE des paramètres publics — jamais de clé privée", async () => {
    // LE point du banc. Le keystore ne sérialise pas `d`, mais c'est ici, sur
    // le fil, que la promesse se vérifie : entre le keystore et la réponse, il
    // y a une méthode de service, un controller et un `JSON.stringify`.
    const res = await get(JWKS);
    expect(res.body).to.not.match(/"d"\s*:/);
    const jwks = JSON.parse(res.body) as { keys: Record<string, unknown>[] };
    expect(jwks.keys.length).to.be.greaterThan(0);
    for (const k of jwks.keys) {
      expect(k).to.not.have.property("d");
      expect(k.kty).to.equal("OKP");
      expect(k.kid).to.be.a("string");
    }
  });

  it("⭐ la boucle se ferme : le document mène AU jeu de clés réellement servi", async () => {
    // C'est tout l'objet du lot — qu'une autre application Nodefony puisse
    // découvrir celle-ci. Elle lit `jwks_uri` dans le document, et va le
    // chercher : ce chemin doit répondre.
    const doc = JSON.parse((await get(METADATA)).body) as { jwks_uri: string };
    const res = await get(new URL(doc.jwks_uri).pathname);
    expect(res.status).to.equal(200);
    expect(JSON.parse(res.body)).to.have.property("keys");
  });

  it("le JWKS expire plus vite que les métadonnées — une rotation doit se propager", async () => {
    const jwks = String((await get(JWKS)).headers["cache-control"] ?? "");
    const meta = String((await get(METADATA)).headers["cache-control"] ?? "");
    const age = (s: string): number =>
      Number(/max-age=(\d+)/.exec(s)?.[1] ?? 0);
    expect(age(jwks)).to.be.lessThan(age(meta));
  });
});
