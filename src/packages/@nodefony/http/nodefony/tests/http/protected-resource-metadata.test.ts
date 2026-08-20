/// <reference types="node" />
import { expect } from "chai";
import http from "node:http";
import https from "node:https";

/**
 * Rôle SERVEUR DE RESSOURCE (RFC 9728) — banc d'INTÉGRATION RÉEL contre le
 * serveur live.
 *
 * ⭐ **Ce banc existe parce qu'un `curl` a trouvé ce qu'aucun unitaire ne
 * pouvait voir.** Le défi posé sur un `401` était syntaxiquement parfait, le
 * client le lisait, le suivait — et tombait sur un `404` : rien ne montait le
 * document que le pointeur nommait. Les unitaires vérifiaient la CHAÎNE
 * composée, jamais ce qui se trouve au bout. La règle qu'ils ne remplacent pas :
 * quand un livrable ÉMET une référence, la déréférencer une fois en réel fait
 * partie de la livraison.
 *
 * Ce qui est éprouvé ici, et qui exige les trois frontières à la fois
 * (`Firewall.publishedProtectedResources()` → montage conditionnel dans le
 * module framework → `bypassFirewall` sur la route) :
 *
 * 1. le document EXISTE au chemin exact que le défi annonce ;
 * 2. la **boucle est fermée** — le `401` d'une zone protégée nomme une URL, et
 *    cette URL répond `200` avec la bonne `resource` ;
 * 3. il n'est servi que sur **l'autorité de sa ressource** (§3.3) — c'est la
 *    faille déjà vécue sur le document d'émetteur, qu'un vrai client MCP avait
 *    trouvée : servi partout, il est REJETÉ par le client, qui s'arrête ; en
 *    `404`, le client continue simplement sans authentification ;
 * 4. le pare-feu ne s'interpose pas — un document qui explique comment
 *    s'authentifier ne peut pas exiger d'être authentifié.
 *
 * Décor (`src/modules/test/nodefony/config/config.ts`, inchangé pour ce banc) :
 *
 * | zone                    | ressource                        | document attendu             |
 * | ----------------------- | -------------------------------- | ---------------------------- |
 * | `test-self-external`    | `https://localhost:5152`         | servi sur `localhost:5152`   |
 * | `test-foreign-audience` | `https://api.foreign.example/v1` | JAMAIS (autorité inatteignable) |
 *
 * La seconde n'est pas un oubli : c'est la **contre-épreuve**. Son autorité
 * n'est celle d'aucun serveur d'ici, donc son document ne doit apparaître nulle
 * part — un montage qui répondrait « au chemin, peu importe l'hôte » la
 * servirait, et le banc le verrait.
 */

const TLS = { hostname: "localhost", port: 5152, rejectUnauthorized: false };
const CLEAR = { hostname: "localhost", port: 5151 };
/** Ressource `https://localhost:5152` ⇒ document à la RACINE (RFC 9728 §3.1). */
const METADATA = "/.well-known/oauth-protected-resource";
/** Ressource `https://api.foreign.example/v1` ⇒ chemin INSÉRÉ. */
const FOREIGN_METADATA = "/.well-known/oauth-protected-resource/v1";
/** Porte protégée par la zone `test-self-external` — c'est elle qui défie. */
const PROTECTED = "/nodefony/test/self-external/whoami";
const RESOURCE = "https://localhost:5152";
const TIMEOUT = 10_000;

type Res = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
};

/** Requête sur l'autorité de la ressource (`https://localhost:5152`). */
function get(path: string): Promise<Res> {
  return new Promise((resolve, reject) => {
    const r = https.request({ ...TLS, method: "GET", path }, (res) => {
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

/** Même chemin, mais par une autorité dont la ressource ne se réclame PAS. */
function getElsewhere(path: string): Promise<Res> {
  return new Promise((resolve, reject) => {
    const r = http.request({ ...CLEAR, method: "GET", path }, (res) => {
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

/**
 * 🔴 **La sonde de décor NE DOIT PAS interroger le document** — sinon elle
 * confond « décor absent » et « ce que ce banc doit prouver ».
 *
 * Écrite naïvement, elle demandait le document : montage débranché ⇒ `404` ⇒
 * « décor manquant » ⇒ suite SAUTÉE ⇒ **vert**. Le banc se serait éteint
 * exactement le jour où il devait mordre. C'est le piège déjà vécu, où une
 * sonde lisant un `401` avait conclu « serveur absent » et fait taire treize
 * tests sans un mot.
 *
 * Le décor, c'est la **zone** : le module `@nodefony/test` (`policy:"dev"`) est
 * chargé et sa porte protégée REFUSE. On l'observe donc sur la porte, jamais
 * sur le document — la porte répond `401` quand la zone existe, `404` quand le
 * module n'est pas là. Le document, lui, est ce que le banc juge.
 */
async function decorAbsent(): Promise<string | null> {
  try {
    const res = await get(PROTECTED);
    if (res.status === 401) return null;
    return (
      `${PROTECTED} rend ${res.status} au lieu de 401 — la zone ` +
      `\`test-self-external\` n'est pas montée (module @nodefony/test absent, ` +
      `attendu hors développement).`
    );
  } catch (e) {
    return `${PROTECTED} injoignable : ${(e as Error).message}`;
  }
}

const raisonDuSaut = await decorAbsent();
if (raisonDuSaut !== null) {
  // Écriture BRUTE sur stderr : le runner avale la console d'un fichier sauté.
  process.stderr.write(
    `\n[protected-resource-metadata] SUITE SAUTÉE — le décor manque :\n  - ${raisonDuSaut}\n\n`,
  );
}

describe.skipIf(raisonDuSaut !== null)(
  "RFC 9728 — le document que le défi promet existe vraiment",
  () => {
    it(
      "sert le document de la ressource, sur l'autorité de la ressource",
      { timeout: TIMEOUT },
      async () => {
        const res = await get(METADATA);
        expect(
          res.status,
          `attendu 200 sur ${METADATA} — reçu ${res.status}`,
        ).to.equal(200);

        const doc = JSON.parse(res.body);
        // `resource` est le SEUL champ requis par la RFC — et c'est celui qu'un
        // client compare à l'URI qu'il interrogeait avant d'accepter le document.
        expect(doc.resource).to.equal(RESOURCE);
        // La spécification MCP exige au moins un serveur d'autorisation : sans lui,
        // le client apprendrait qu'un jeton est nécessaire sans pouvoir en obtenir.
        expect(doc.authorization_servers).to.be.an("array").that.is.not.empty;
        expect(doc.authorization_servers).to.include(RESOURCE);
        // Jamais la chaîne de requête : une URL finit dans les journaux, l'historique
        // et le `Referer`.
        expect(doc.bearer_methods_supported).to.deep.equal(["header"]);
      },
    );

    it(
      "🔴 FERME LA BOUCLE — le défi d'un 401 nomme une URL, et cette URL répond",
      { timeout: TIMEOUT },
      async () => {
        const refused = await get(PROTECTED);
        expect(
          refused.status,
          "la zone doit refuser une requête sans jeton",
        ).to.equal(401);

        const challenge = String(refused.headers["www-authenticate"] ?? "");
        const pointer = /resource_metadata="([^"]+)"/.exec(challenge);
        expect(
          pointer,
          `le défi doit nommer le document — reçu « ${challenge} »`,
        ).to.not.equal(null);

        // C'est ICI que le trou se voyait : l'URL était conforme et rendait 404.
        // On la suit exactement comme un client conforme le ferait.
        const url = new URL(pointer![1]);
        const followed = await get(`${url.pathname}${url.search}`);
        expect(
          followed.status,
          `le pointeur du défi mène à ${followed.status} — un client conclurait « pas d'autorisation ici »`,
        ).to.equal(200);
        expect(JSON.parse(followed.body).resource).to.equal(RESOURCE);
      },
    );

    it(
      "ne place PAS le document derrière l'authentification (il explique comment s'authentifier)",
      { timeout: TIMEOUT },
      async () => {
        const res = await get(METADATA);
        expect(res.status).to.not.equal(401);
        expect(res.headers["www-authenticate"]).to.equal(undefined);
      },
    );

    it(
      "le met en cache — sans directive, un client conforme le redemande à chaque connexion",
      { timeout: TIMEOUT },
      async () => {
        const res = await get(METADATA);
        expect(String(res.headers["cache-control"] ?? "")).to.contain(
          "max-age=",
        );
      },
    );

    it(
      "🔴 REFUSE de le servir sur une autre autorité — un document rejeté ARRÊTE le client, un 404 le laisse continuer",
      { timeout: TIMEOUT },
      async () => {
        // 🔴 D'ABORD le cas POSITIF, et ce n'est pas une précaution de style : sans
        // lui, ce test est satisfait par la disparition pure et simple du document
        // — il rendrait 404 partout, donc « vert », le jour où plus rien n'est
        // monté. Un test purement négatif ne peut pas échouer.
        expect(
          (await get(METADATA)).status,
          "le document doit exister sur l'autorité de sa ressource",
        ).to.equal(200);

        const res = await getElsewhere(METADATA);
        expect(
          res.status,
          "le document de `https://localhost:5152` ne doit pas exister sur le port 5151",
        ).to.equal(404);
      },
    );

    it(
      "ne publie RIEN pour une ressource d'un autre hôte — la contre-épreuve `test-foreign-audience`",
      { timeout: TIMEOUT },
      async () => {
        // Même raison : on constate d'abord qu'un document EST publié quelque part,
        // sinon deux 404 sur une capacité éteinte se liraient comme un succès.
        expect(
          (await get(METADATA)).status,
          "au moins une ressource doit être publiée pour que ce refus ait un sens",
        ).to.equal(200);

        const onTls = await get(FOREIGN_METADATA);
        const onClear = await getElsewhere(FOREIGN_METADATA);
        expect(
          onTls.status,
          "autorité `api.foreign.example` ≠ `localhost:5152`",
        ).to.equal(404);
        expect(
          onClear.status,
          "autorité `api.foreign.example` ≠ `localhost:5151`",
        ).to.equal(404);
      },
    );
  },
);
