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

/** Lecture sur le canal TLS — l'autorité de l'émetteur, seule à publier. */
function getTls(path: string): Promise<Res> {
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

async function accessToken(
  scope?: string,
  resource?: unknown,
): Promise<string> {
  const res = await postJson(TOKEN_URL, {
    ...ADMIN,
    ...(scope ? { scope } : {}),
    ...(resource !== undefined ? { resource } : {}),
  });
  expect(res.status, "grant credential attendu 200").to.equal(200);
  const token = (JSON.parse(res.body) as { access_token?: unknown })
    .access_token;
  expect(token, "access_token attendu").to.be.a("string");
  return token as string;
}

/** Demande de jeton dont on attend le REFUS — rend la réponse telle quelle. */
function tokenRequest(resource: unknown): Promise<Res> {
  return postJson(TOKEN_URL, { ...ADMIN, resource });
}

/** Aide au diagnostic : un 503 ici désigne le décor, pas le code sous test. */
const decor =
  "503 = l'émetteur n'a pas pu être joint. Le serveur est-il lancé par " +
  "`start.sh` (NODE_EXTRA_CA_CERTS = CA de développement) ?";

/**
 * Le décor de ce banc EXISTE-t-il — `null` si oui, la raison sinon.
 *
 * Tout repose sur une capacité qui n'est pas universelle : cette application
 * doit publier ses métadonnées d'émetteur, et sous l'identité exacte que les
 * zones du banc exigent en audience. C'est vrai du serveur de développement ;
 * ce ne l'est pas d'un serveur lancé en **production** sans `NF_JWT_ISSUER`,
 * où rien n'est publié — délibérément (RFC 8414 §2 exige une URL https, et une
 * application ne devine pas la sienne derrière un relais).
 *
 * Un banc qui rougit là où la capacité n'existe pas accuse le code d'un défaut
 * de décor. Il saute donc — mais **en le DISANT** : un fichier sauté en silence
 * est un vert qu'on croit.
 */
async function decorAbsent(): Promise<string | null> {
  try {
    const res = await getTls(METADATA);
    if (res.status !== 200) {
      return (
        `${METADATA} rend ${res.status} — cette application ne publie pas ses ` +
        `métadonnées d'émetteur (\`security.jwt.issuer\` en URL https ? ` +
        `\`jwt.jwks\` ?). Attendu en production sans NF_JWT_ISSUER.`
      );
    }
    const doc = JSON.parse(res.body) as { issuer?: unknown };
    if (doc.issuer !== ISSUER) {
      return (
        `émetteur publié « ${String(doc.issuer)} » ≠ « ${ISSUER} » — ce banc et ` +
        `les zones qu'il vise sont écrits pour l'émetteur de développement ; ` +
        `NF_JWT_ISSUER change l'audience exigée.`
      );
    }
    return null;
  } catch (e) {
    return `${METADATA} injoignable : ${(e as Error).message}`;
  }
}

const raisonDuSaut = await decorAbsent();
if (raisonDuSaut !== null) {
  // Écriture BRUTE sur stderr : le runner avale la console d'un fichier sauté.
  process.stderr.write(
    `\n[external-jwt-e2e] SUITE SAUTÉE — le décor manque :\n  - ${raisonDuSaut}\n\n`,
  );
}

describe.skipIf(raisonDuSaut !== null)(
  "Jeton émis ICI, vérifié comme celui d'un TIERS (P6.9 e2e)",
  () => {
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
  },
);

/**
 * **Un jeton demandé POUR une ressource n'ouvre que celle-là** — RFC 8707.
 *
 * Le banc ci-dessus prouve qu'un jeton est refusé par une zone dont l'audience
 * diffère. Il ne dit rien du cas utile : obtenir un jeton pour CETTE ressource.
 * Tant que l'audience est un défaut de configuration, une application n'a qu'une
 * seule porte ouvrable — la porte MCP, une API interne et le reste doivent alors
 * partager la même audience, c'est-à-dire renoncer à la garde.
 *
 * Le paramètre `resource` du grant renverse cela : le client nomme sa cible,
 * l'émetteur vérifie qu'il accepte de la servir, et le jeton porte cette
 * audience-là. Ce qui se prouve ici est la **symétrie** : le même compte, le même
 * mot de passe, deux demandes qui ne diffèrent que par `resource` — et deux
 * jetons dont chacun est refusé par la porte de l'autre.
 */
describe.skipIf(raisonDuSaut !== null)(
  "Un jeton n'ouvre que la ressource pour laquelle il est demandé",
  () => {
    const FOREIGN_RESOURCE = "https://api.foreign.example/v1";

    it("⭐ demandé pour l'autre ressource, il ouvre CETTE porte…", async () => {
      const token = await accessToken(undefined, FOREIGN_RESOURCE);
      const res = await get(FOREIGN, { authorization: `Bearer ${token}` });
      expect(res.status, decor).to.equal(200);
      expect(
        (JSON.parse(res.body) as { foreignAudience?: unknown }).foreignAudience,
      ).to.equal(true);
    });

    it("⭐ …et se ferme sur celle d'à côté — la symétrie est complète", async () => {
      // Le pendant du test d'audience plus haut. Les deux ensemble disent la
      // règle entière : un jeton vaut pour UNE ressource, celle qui a été
      // demandée, et pour aucune autre.
      const token = await accessToken(undefined, FOREIGN_RESOURCE);
      const res = await get(WHOAMI, { authorization: `Bearer ${token}` });
      expect(res.status).to.equal(401);
    });

    it("🔴 une ressource NON déclarée est refusée à l'ÉMISSION (`invalid_target`)", async () => {
      // Le refus tombe là où la faute est commise. Servie avec l'audience par
      // défaut, la demande rendrait un jeton valide — pour quelqu'un d'autre — et
      // le client ne découvrirait le problème qu'en recevant un 401 d'une porte
      // qui, elle, n'a rien fait de mal.
      const res = await tokenRequest("https://api.inconnue.example/v1");
      expect(res.status).to.equal(400);
      const body = JSON.parse(res.body) as Record<string, unknown>;
      expect(body.error).to.equal("invalid_target");
      // La liste des audiences acceptées ne fuit pas : ce serait la carte des
      // ressources protégées, offerte à qui possède un simple identifiant.
      expect(res.body).to.not.match(/foreign\.example|localhost:5152/);
    });

    it("🔴 plusieurs ressources à la fois : refusé (RFC 8707 §3)", async () => {
      // Un jeton à plusieurs destinataires est utilisable par chacun d'eux chez
      // les autres — la RFC prévoit explicitement qu'un serveur soit « unwilling
      // or unable » de le délivrer.
      const res = await tokenRequest([
        FOREIGN_RESOURCE,
        "https://localhost:5152",
      ]);
      expect(res.status).to.equal(400);
      expect((JSON.parse(res.body) as { error?: unknown }).error).to.equal(
        "invalid_target",
      );
    });

    it("une valeur qui n'est pas une URI absolue est refusée", async () => {
      const res = await tokenRequest("/nodefony/mcp");
      expect(res.status).to.equal(400);
      expect((JSON.parse(res.body) as { error?: unknown }).error).to.equal(
        "invalid_target",
      );
    });

    it("sans `resource`, rien ne change — l'audience par défaut s'applique", async () => {
      // Contrôle positif : le paramètre est une OPTION. Une application qui ne
      // l'emploie pas ne doit rien voir de ce lot.
      const res = await get(WHOAMI, {
        authorization: `Bearer ${await accessToken()}`,
      });
      expect(res.status, decor).to.equal(200);
    });
  },
);

/**
 * **Red-team du paramètre `resource` lui-même.**
 *
 * Nommer sa cible est une nouvelle entrée contrôlée par le client, donc une
 * nouvelle surface. Trois questions qu'aucun test fonctionnel ne pose : le refus
 * renseigne-t-il un anonyme ? la rotation permet-elle d'obtenir ce que
 * l'émission a refusé ? une valeur qui n'est pas une chaîne fait-elle tomber le
 * serveur ?
 */
describe.skipIf(raisonDuSaut !== null)(
  "Red-team — la demande de ressource comme surface d'attaque",
  () => {
    const FOREIGN_RESOURCE = "https://api.foreign.example/v1";

    it("🔴 le refus d'audience n'est PAS un oracle pour un anonyme", async () => {
      // L'ORDRE est la garde : le credential est vérifié AVANT que la ressource
      // soit examinée. Inversé, ce point de terminaison rendrait la carte des
      // ressources protégées à qui n'a même pas de compte — `400` pour une
      // audience inconnue, `401` pour une déclarée, il suffit de comparer.
      const res = await postJson(TOKEN_URL, {
        username: "admin",
        password: "mauvais-mot-de-passe",
        resource: FOREIGN_RESOURCE,
      });
      expect(res.status).to.equal(401);
      expect((JSON.parse(res.body) as { error?: unknown }).error).to.equal(
        "invalid_grant",
      );
    });

    it("🔴 la ROTATION n'élargit pas la portée — même déclarée, une autre audience est refusée", async () => {
      // Le chemin détourné : obtenir un jeton pour A, puis demander B au
      // renouvellement. La RFC borne les ressources d'un `refresh_token` à celles
      // accordées à l'origine (§2.2) ; ici une seule audience, donc elle seule.
      const issued = await postJson(TOKEN_URL, {
        ...ADMIN,
        resource: FOREIGN_RESOURCE,
      });
      const refresh = (JSON.parse(issued.body) as { refresh_token: string })
        .refresh_token;
      const res = await postJson(`${TOKEN_URL}/refresh`, {
        refresh_token: refresh,
        resource: "https://localhost:5152",
      });
      expect(res.status).to.equal(400);
      expect((JSON.parse(res.body) as { error?: unknown }).error).to.equal(
        "invalid_target",
      );
    });

    it("la rotation CONSERVE l'audience accordée (sans la redemander)", async () => {
      // Le pendant positif : une portée restreinte qui s'annulerait au premier
      // renouvellement ne serait pas une restriction. Le jeton renouvelé doit
      // ouvrir la même porte, et elle seule.
      const issued = await postJson(TOKEN_URL, {
        ...ADMIN,
        resource: FOREIGN_RESOURCE,
      });
      const refresh = (JSON.parse(issued.body) as { refresh_token: string })
        .refresh_token;
      const rotated = await postJson(`${TOKEN_URL}/refresh`, {
        refresh_token: refresh,
      });
      expect(rotated.status).to.equal(200);
      const access = (JSON.parse(rotated.body) as { access_token: string })
        .access_token;
      expect(
        (await get(FOREIGN, { authorization: `Bearer ${access}` })).status,
      ).to.equal(200);
      expect(
        (await get(WHOAMI, { authorization: `Bearer ${access}` })).status,
      ).to.equal(401);
    });

    it("une `resource` qui n'est pas une chaîne est refusée, jamais une 500", async () => {
      // Le corps est du JSON : le client choisit le TYPE autant que la valeur.
      for (const bogus of [{}, 42, true]) {
        const res = await tokenRequest(bogus);
        expect(res.status, `resource = ${JSON.stringify(bogus)}`).to.equal(400);
      }
    });
  },
);
