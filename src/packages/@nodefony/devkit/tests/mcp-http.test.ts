import { describe, it, expect } from "vitest";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import {
  MCP_ENDPOINT_PATH,
  MCP_PROTOCOL_VERSION,
  protectedResourceMetadataPath,
} from "nodefony";

/** Où la RFC 9728 fait chercher les métadonnées de CETTE porte. */
const MCP_METADATA_PATH = protectedResourceMetadataPath(MCP_ENDPOINT_PATH);

/**
 * Ce que cette suite prouve, et que rien d'autre ne prouve : la ROUTE.
 *
 * Le protocole, les gardes et la collecte des outils sont éprouvés au cœur, en
 * fonctions pures, sans serveur. Il reste tout ce qui ne s'éprouve QUE sur un
 * serveur réel — que la route soit montée à l'URL publiée, que la garde
 * `Origin` morde vraiment sur une requête HTTP, que les statuts posés par le
 * protocole traversent le controller intacts, et surtout que le module d'une
 * application voie son outil publié via `kernel.modules`. Ce dernier chemin
 * n'existe qu'ici : une suite unitaire fabrique ses modules, elle ne parcourt
 * pas ceux d'un kernel qui tourne.
 *
 * Décor requis : le serveur de développement de CE dépôt (`start.sh` du skill
 * `nodefony-start-server`), qui charge `@nodefony/devkit` (`policy: "dev"`) et
 * le module `test` — lequel déclare l'outil `test_probe` pour ce banc.
 *
 * Quand le décor manque, la suite SAUTE en le DISANT : un banc sauté en silence
 * est un vert qu'on croit.
 */

const BASE = process.env.NF_MCP_TEST_BASE ?? "https://127.0.0.1:5152";

/**
 * Autorité par laquelle le document de ressource protégée est PUBLIÉ.
 *
 * 🔴 Ce n'est pas `BASE`, et l'écart est instructif : le document n'est servi
 * que sur l'autorité de sa `resource` (RFC 9728 §3.3) — ici
 * `http://localhost:5151/nodefony/mcp`, c'est-à-dire exactement l'adresse par
 * laquelle un vrai client entre (`.mcp.json`). Ce banc, lui, postait ses
 * messages sur `https://127.0.0.1:5152` : une autre autorité. Tant que le
 * document était servi partout, la différence ne se voyait pas — et c'est
 * précisément le défaut qui avait fait ARRÊTER un client MCP sur le document
 * d'émetteur, qu'il recevait d'une autorité dont l'émetteur ne se réclamait pas.
 */
const RESOURCE_BASE =
  process.env.NF_MCP_TEST_RESOURCE_BASE ?? "http://localhost:5151";

/**
 * Jeton porteur de la suite — **déclaré ici, avant `poster`**, et pas plus bas.
 * Il est obtenu EN APPELANT `poster` : un `const` initialisé après la fonction
 * serait lu pendant sa propre obtention (zone morte temporelle), et la suite
 * entière tomberait sur une `ReferenceError` au lieu de sauter proprement.
 */
let JETON: string | null = null;

/** Réponse brute d'un appel à la porte MCP. */
interface IReponse {
  status: number;
  body: unknown;
  raw: string;
}

/**
 * Poste un message JSON-RPC sur la porte MCP (ou sur `chemin`, pour le grant).
 *
 * Le jeton est ajouté d'office quand la porte en exige un : la spécification
 * MCP impose l'en-tête `Authorization` sur **chaque** requête, pas seulement à
 * la première. Un appel qui veut éprouver le refus passe `{ authorization: "" }`
 * — la chaîne vide écrase l'en-tête sans le remplacer.
 */
function poster(
  message: unknown,
  headers: Record<string, string> = {},
  chemin: string = MCP_ENDPOINT_PATH,
): Promise<IReponse> {
  return new Promise((resoudre, rejeter) => {
    const charge = JSON.stringify(message);
    const porteur =
      typeof JETON === "string" && chemin === MCP_ENDPOINT_PATH
        ? { authorization: `Bearer ${JETON}` }
        : {};
    const req = httpsRequest(
      `${BASE}${chemin}`,
      {
        method: "POST",
        rejectUnauthorized: false,
        timeout: 8000,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(charge),
          ...porteur,
          ...headers,
        },
      },
      (res) => {
        let texte = "";
        res.setEncoding("utf8");
        res.on("data", (morceau: string) => (texte += morceau));
        res.on("end", () => {
          let body: unknown = null;
          try {
            body = texte === "" ? null : JSON.parse(texte);
          } catch {
            body = null;
          }
          resoudre({ status: res.statusCode ?? 0, body, raw: texte });
        });
      },
    );
    req.on("error", rejeter);
    req.on("timeout", () => {
      req.destroy();
      rejeter(new Error("timeout"));
    });
    req.end(charge);
  });
}

/** Lit un chemin en `GET` — pour les routes qui ne parlent pas JSON-RPC. */
/**
 * Lit un document bien connu sur l'autorité de la RESSOURCE, en clair.
 *
 * Un client conforme construit cette URL depuis l'URI de la ressource ; le banc
 * fait donc de même, au lieu de la demander à l'hôte qui lui est commode.
 */
function lireDocument(chemin: string): Promise<IReponse> {
  return new Promise((resoudre, rejeter) => {
    const req = httpRequest(
      `${RESOURCE_BASE}${chemin}`,
      { method: "GET", timeout: 8000 },
      (res) => {
        let texte = "";
        res.setEncoding("utf8");
        res.on("data", (morceau: string) => (texte += morceau));
        res.on("end", () => {
          let body: unknown = null;
          try {
            body = texte === "" ? null : JSON.parse(texte);
          } catch {
            body = null;
          }
          resoudre({ status: res.statusCode ?? 0, body, raw: texte });
        });
      },
    );
    req.on("error", rejeter);
    req.on("timeout", () => {
      req.destroy();
      rejeter(new Error("timeout"));
    });
    req.end();
  });
}

function lire(chemin: string): Promise<IReponse> {
  return new Promise((resoudre, rejeter) => {
    const req = httpsRequest(
      `${BASE}${chemin}`,
      { method: "GET", rejectUnauthorized: false, timeout: 8000 },
      (res) => {
        let texte = "";
        res.setEncoding("utf8");
        res.on("data", (morceau: string) => (texte += morceau));
        res.on("end", () => {
          let body: unknown = null;
          try {
            body = texte === "" ? null : JSON.parse(texte);
          } catch {
            body = null;
          }
          resoudre({ status: res.statusCode ?? 0, body, raw: texte });
        });
      },
    );
    req.on("error", rejeter);
    req.on("timeout", () => {
      req.destroy();
      rejeter(new Error("timeout"));
    });
    req.end();
  });
}

/**
 * Obtient un jeton POUR cette porte, en se comportant comme un client conforme.
 *
 * Le chemin est celui que la RFC 9728 dessine, et il n'est pas deviné : la porte
 * refuse, son défi `WWW-Authenticate` désigne un document de métadonnées, ce
 * document nomme la ressource (l'audience à demander) et son serveur
 * d'autorisation. Le banc suit ce fil plutôt que de recopier des constantes —
 * ainsi il éprouve la boucle de découverte au lieu de la supposer.
 *
 * @returns le jeton, ou `null` si la porte n'exige aucune autorisation
 */
async function jetonPourLaPorte(
  scopeDemande: string | null = "admin:read",
): Promise<string | null> {
  // 🔴 Tout est enveloppé : ce code s'exécute à l'IMPORT du fichier, avant que
  // la sonde de décor ait pu conclure quoi que ce soit. Une exception ici ne
  // ferait pas sauter la suite — elle la ferait ÉCHOUER, et sans serveur, ce qui
  // est le cas normal d'une passe unitaire. Vécu : `ECONNREFUSED` a rendu rouges
  // les tests unitaires du paquet sur les quatre combinaisons OS × Node de la
  // forge, pour un fichier qui aurait dû simplement se déclarer hors décor.
  try {
    const metadonnees = await lireDocument(MCP_METADATA_PATH);
    if (metadonnees.status !== 200) return null; // porte anonyme : rien à demander
    const doc = metadonnees.body as { resource?: unknown };
    if (typeof doc.resource !== "string") return null;
    // Le grant par credential de CETTE application. `resource` (RFC 8707)
    // demande un jeton dont l'audience est la porte — sans lui, l'audience par
    // défaut serait celle de l'application, et la porte refuserait à juste titre.
    const reponse = await poster(
      {
        username: "admin",
        password: "secret",
        resource: doc.resource,
        // 🔴 Le scope se DEMANDE. La porte protégée exige désormais un scope
        // d'administration : un jeton d'audience valide qui n'en porte aucun
        // est refusé. Ce que la porte accepte est publié dans
        // `scopes_supported` du document de ressource protégée — le banc ne
        // devine rien, et `null` sert à éprouver le refus.
        ...(scopeDemande === null ? {} : { scope: scopeDemande }),
      },
      {},
      "/nodefony/security/api/token",
    );
    const jeton = (reponse.body as { access_token?: unknown } | null)
      ?.access_token;
    return typeof jeton === "string" ? jeton : null;
  } catch {
    // Serveur absent, injoignable, ou porte muette : il n'y a pas de jeton à
    // obtenir. La sonde `porteMuette()` dira pourquoi la suite saute.
    return null;
  }
}

// Obtenu UNE fois, avant toute assertion (cf la déclaration de `JETON` plus haut).
JETON = await jetonPourLaPorte();

/** La porte répond-elle — null si oui, la raison sinon. */
async function porteMuette(): Promise<string | null> {
  try {
    const reponse = await poster({ jsonrpc: "2.0", id: 0, method: "ping" });
    if (reponse.status === 401) {
      // La porte VIT, elle est protégée : ce n'est pas un décor manquant. Si le
      // jeton n'a pas pu être obtenu, en revanche, la suite ne peut rien prouver
      // et doit le dire au lieu de rendre des rouges qui accusent le code.
      return JETON === null
        ? `${BASE}${MCP_ENDPOINT_PATH} exige un jeton et le grant a échoué — ` +
            `comptes de développement provisionnés ? \`security.jwt.audiences\` ` +
            `contient-il l'URI de la porte ?`
        : null;
    }
    if (reponse.status !== 200) {
      return `${BASE}${MCP_ENDPOINT_PATH} rend ${reponse.status} sur un ping — devkit chargé ? mcp.enabled ?`;
    }
    return null;
  } catch (e) {
    return `${BASE}${MCP_ENDPOINT_PATH} injoignable : ${(e as Error).message} — lancer le serveur de développement`;
  }
}

const raison = await porteMuette();
if (raison !== null) {
  // Écriture BRUTE sur stderr : le runner avale la console d'un fichier sauté.
  process.stderr.write(
    `\n[mcp-http] SUITE SAUTÉE — le décor manque :\n  - ${raison}\n\n`,
  );
}

/** Extrait la liste d'outils d'une réponse `tools/list`. */
function outilsDe(reponse: IReponse): { name: string; description: string }[] {
  return (
    reponse.body as {
      result: { tools: { name: string; description: string }[] };
    }
  ).result.tools;
}

describe.skipIf(raison !== null)(
  "MCP — la porte HTTP, sur serveur réel",
  () => {
    it("publie les outils INTÉGRÉS à l'URL du contrat public", async () => {
      const reponse = await poster({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      });
      expect(reponse.status).toBe(200);
      const noms = outilsDe(reponse).map((t) => t.name);
      expect(noms).toContain("nodefony_card");
      expect(noms).toContain("nodefony_inspect");
    });

    it("🔴 publie AUSSI l'outil déclaré par un module de l'application", async () => {
      // LE chemin que seul un serveur exerce : le controller parcourt
      // `kernel.modules` et lit `getMcpTools()` sur des instances réelles.
      const reponse = await poster({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
      });
      const sonde = outilsDe(reponse).find((t) => t.name === "test_probe");
      expect(
        sonde,
        "le module `test` déclare `test_probe` — absent = registre non branché",
      ).toBeDefined();
      expect(sonde?.description).toMatch(/module de test/u);
    });

    it("🔴 et l'outil d'un module RÉPOND, arguments compris", async () => {
      const reponse = await poster({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "test_probe", arguments: { message: "bonjour" } },
      });
      expect(reponse.status).toBe(200);
      const result = (
        reponse.body as { result: { content: { text: string }[] } }
      ).result;
      expect(JSON.parse(result.content[0].text)).toEqual({
        module: "test",
        echo: "bonjour",
      });
    });

    it("🔴 un outil PROTÉGÉ n'apparaît pas — la porte n'authentifie personne", async () => {
      // Fail-closed sur la route RÉELLE : le controller câble un appelant
      // anonyme (aucun jeton n'est validé ici), donc `test_probe_secret`, qui
      // exige un scope, ne doit pas exister du point de vue du client.
      const reponse = await poster({
        jsonrpc: "2.0",
        id: 20,
        method: "tools/list",
      });
      const noms = outilsDe(reponse).map((t) => t.name);
      expect(noms).toContain("test_probe");
      expect(
        noms,
        "un outil à scopes ne doit pas être publié sans autorisation",
      ).not.toContain("test_probe_secret");
    });

    it("🔴 ET il reste inappelable en le nommant — pas un simple rideau", async () => {
      const reponse = await poster({
        jsonrpc: "2.0",
        id: 21,
        method: "tools/call",
        params: { name: "test_probe_secret", arguments: {} },
      });
      const error = (
        reponse.body as { error: { code: number; message: string } }
      ).error;
      expect(error.code).toBe(-32602);
      // « inconnu », pas « interdit » : l'existence même n'est pas révélée.
      expect(error.message).toMatch(/inconnu/u);
      expect(reponse.raw).not.toMatch(/scope|autoris/iu);
    });

    it("un outil intégré traverse le controller sans se déformer", async () => {
      const reponse = await poster({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "nodefony_inspect", arguments: { subject: "modules" } },
      });
      expect(reponse.status).toBe(200);
      const result = (
        reponse.body as {
          result: { content: { text: string }[]; isError?: true };
        }
      ).result;
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toMatch(/@nodefony\/devkit/u);
    });

    it("🔴 le MÊME compte, un jeton SANS scope : la lecture est REFUSÉE", async () => {
      // C'était le trou : la lecture d'administration fabriquait un
      // administrateur, donc tout porteur d'un jeton d'audience valide obtenait
      // tout — la vérification RFC 8707 prouve que le jeton VISE cette
      // ressource, jamais ce que son porteur a le droit d'y faire.
      //
      // Même utilisateur, même mot de passe, même audience que le jeton de la
      // suite : SEUL le scope change. Si ce cas passait, le durcissement ne
      // tiendrait à rien.
      const sansScope = await jetonPourLaPorte(null);
      expect(sansScope, "grant sans scope attendu").toBeTypeOf("string");
      const reponse = await poster(
        {
          jsonrpc: "2.0",
          id: 41,
          method: "tools/call",
          params: {
            name: "nodefony_inspect",
            arguments: { subject: "modules" },
          },
        },
        { authorization: `Bearer ${sansScope as string}` },
      );
      const result = (
        reponse.body as {
          result: { content: { text: string }[]; isError?: true };
        }
      ).result;
      expect(result.isError).toBe(true);
      // Le refus DIT qui est refusé et ce qui manque : sans cela, l'appelant
      // cherche une autre cible au lieu d'un meilleur jeton.
      expect(result.content[0].text).toMatch(/ROLE_NODEFONY_ADMIN/u);
      expect(result.content[0].text).toMatch(/admin/u);
    });

    it("🔴 la garde Origin MORD sur la vraie route (DNS rebinding)", async () => {
      // Une page web malveillante pose TOUJOURS un Origin ; un client MCP natif
      // n'en pose aucun. C'est toute la sécurité de cette porte sans OAuth.
      const reponse = await poster(
        { jsonrpc: "2.0", id: 5, method: "tools/list" },
        { origin: "https://evil.example" },
      );
      expect(reponse.status).toBe(403);
      // Le motif du refus reste au journal : l'appelant n'apprend pas quelles
      // origines seraient admises.
      expect(reponse.raw).not.toMatch(/allowedOrigins|localhost/u);
    });

    it("une notification rend 202 SANS corps — jusque dans la réponse HTTP", async () => {
      const reponse = await poster({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      });
      expect(reponse.status).toBe(202);
      expect(reponse.raw).toBe("");
    });

    it("une méthode inconnue rend 404 ET -32601", async () => {
      const reponse = await poster({
        jsonrpc: "2.0",
        id: 6,
        method: "resources/list",
      });
      expect(reponse.status).toBe(404);
      expect((reponse.body as { error: { code: number } }).error.code).toBe(
        -32601,
      );
    });

    it("🔴 `server/discover` n'est PAS servi — et c'est le signal de repli", async () => {
      // Retrait MESURÉ, pas un oubli (cf `mcp/server.ts`, le bloc de commentaire
      // au-dessus du `switch`) : quand ce serveur répondait à `server/discover`,
      // le client dominant basculait sur son fil moderne, rejouait `tools/list`
      // quatre fois et n'enregistrait AUCUN outil — « connected », porte morte.
      // C'est l'erreur `-32601` qui fait suivre au client le repli que la spec
      // prévoit (« tries server/discover, gets an error, falls back to
      // initialize »). Ce test garde donc l'ABSENCE, pas la présence : le jour
      // où un client réel achève le fil moderne, il tombera — et c'est voulu.
      const reponse = await poster({
        jsonrpc: "2.0",
        id: 7,
        method: "server/discover",
      });
      expect(reponse.status).toBe(404);
      expect((reponse.body as { error: { code: number } }).error.code).toBe(
        -32601,
      );
    });

    it("🔴 `initialize` ÉCHOTE la révision du client — jusque sur la route", async () => {
      // Le défaut trouvé par un VRAI client : la route annonçait `2026-07-28` à
      // tout le monde, et le SDK de référence (1.30.0, `LATEST = 2025-11-25`)
      // raccrochait. Éprouvé ici de bout en bout, parce que c'est là que le
      // client parle — pas dans une fonction pure.
      const reponse = await poster({
        jsonrpc: "2.0",
        id: 8,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "banc", version: "1" },
        },
      });
      expect(reponse.status).toBe(200);
      const result = (
        reponse.body as {
          result: { protocolVersion: string; serverInfo: { name: string } };
        }
      ).result;
      expect(result.protocolVersion).toBe("2025-11-25");
      // L'identité du serveur voyage aussi : c'est elle qui distingue DEUX
      // applications Nodefony ouvertes en même temps.
      expect(result.serverInfo.name).toBeTypeOf("string");
      expect(MCP_PROTOCOL_VERSION).not.toBe("2025-11-25");
    });

    it("les métadonnées de la ressource sont SERVIES — et un chemin inconnu ne leur ressemble pas", async () => {
      // Ce dépôt déclare désormais un serveur d'autorisation (lui-même) : le
      // rôle est allumé, donc le document existe. Il porte les deux champs dont
      // un client a besoin pour agir — l'audience à demander (`resource`) et où
      // la demander (`authorization_servers`, que la spécification MCP exige non
      // vide). Sans eux, un client apprendrait qu'un jeton est nécessaire sans
      // jamais pouvoir en obtenir un.
      //
      // Le second appel garde l'enseignement du cas précédent : un chemin de
      // ressource INCONNUE rend l'enveloppe d'erreur du framework (`nodefony`,
      // `requestId`, `stack`) — c'est elle qui cassait le parseur du SDK MCP
      // sondant des chemins OAuth inexistants (« expected string, received
      // object »). Les deux réponses ne doivent jamais se confondre.
      const monte = await lireDocument(MCP_METADATA_PATH);
      const absent = await lireDocument(
        "/.well-known/oauth-protected-resource/aucune",
      );

      expect(monte.status).toBe(200);
      const doc = monte.body as {
        resource?: unknown;
        authorization_servers?: unknown;
      };
      expect(doc.resource).toBeTypeOf("string");
      expect(doc.authorization_servers).to.be.an("array").that.is.not.empty;
      expect(monte.body).not.toHaveProperty("nodefony");

      expect(absent.status).toBe(404);
      expect(absent.body).toHaveProperty("nodefony");
    });

    it("sans jeton, les outils PUBLICS restent servis (mode développement)", async () => {
      // `mcp.authorization.anonymous` : l'ABSENCE de jeton est tolérée. Ce n'est
      // pas un désarmement — c'est la seule façon qu'un client MCP standard
      // reste utilisable tant que cette application n'offre aucun flux
      // d'obtention de jeton (elle n'est pas un serveur d'autorisation OAuth).
      // Les outils qui exigent une identité, eux, restent retenus.
      const reponse = await poster(
        { jsonrpc: "2.0", id: 9, method: "tools/list" },
        { authorization: "" },
      );
      expect(reponse.status).toBe(200);
      expect(outilsDe(reponse).length).toBeGreaterThan(0);
    });

    it("🔴 un jeton d'une AUTRE audience n'ouvre RIEN — la liaison RFC 8707 mord", async () => {
      // LA garde que la tolérance ne doit PAS emporter, mesurée sur ce qui
      // compte : non pas le statut, mais ce que le porteur OBTIENT. Un jeton de
      // cette application, parfaitement signé et valide, mais délivré pour une
      // AUTRE ressource, ne doit ouvrir aucun outil réservé (RFC 8707 §2) —
      // sinon l'audience ne lie rien.
      //
      // ⚠️ Il n'est plus refusé par un `401` : cette porte TOLÈRE l'anonyme, et
      // punir un jeton rejeté plus durement qu'une requête muette coûtait
      // l'outillage entier au premier jeton expiré (le client marque alors le
      // serveur « failed » pour toute la session). Le jeton est donc rétrogradé
      // en anonyme, ce qui n'accorde rien — c'est ce que ce cas prouve. Le
      // `401` d'une porte FERMÉE, lui, est éprouvé au cœur
      // (`oauthProtectedResource.test.ts`).
      const autre = await poster(
        { username: "admin", password: "secret" }, // sans `resource` ⇒ audience par défaut
        {},
        "/nodefony/security/api/token",
      );
      const jeton = (autre.body as { access_token?: unknown } | null)
        ?.access_token;
      expect(jeton, "grant attendu").toBeTypeOf("string");
      const reponse = await poster(
        { jsonrpc: "2.0", id: 10, method: "tools/list" },
        { authorization: `Bearer ${jeton as string}` },
      );
      const noms = outilsDe(reponse).map((t) => t.name);
      expect(noms).to.not.contain("nodefony_admin_list");
      expect(noms).to.not.contain("nodefony_admin_call");
      expect(noms).to.not.contain("test_secret");
      // Et il reçoit bien ce qu'un inconnu reçoit — ni plus, ni moins.
      expect(noms).to.contain("nodefony_card");
    });

    it("🔴 `scopes_supported` est ce que la porte EXIGE — dérivé des outils, pas d'une liste écrite", async () => {
      // La preuve sur l'artefact REÇU : le document qu'un client lit vraiment.
      // Le catalogue de cette application est en LECTURE SEULE — `admin:read`
      // ouvre `admin_list`/`admin_call`, et aucun outil n'exige `admin:write`.
      // La liste écrite en configuration publiait pourtant les deux : le client
      // demandait un droit qui n'ouvrait rien, et il aurait manqué le scope de
      // tout outil qu'un module déclare.
      const doc = (await lireDocument(MCP_METADATA_PATH)).body as {
        scopes_supported?: unknown;
      };
      const publies = doc.scopes_supported as string[];
      // Ce que les outils INTÉGRÉS exigent…
      expect(publies).to.contain("admin:read");
      // …et ce qu'un outil de MODULE exige (`test_secret` du module `test`) —
      // c'est l'écart qu'aucune liste écrite ne pouvait suivre : elle vivait
      // dans la configuration du devkit, l'outil dans un autre paquet.
      expect(publies).to.contain("test:secret");
      // …et RIEN d'autre : `admin:write` était publié alors qu'aucun outil ne
      // l'exige — le client demandait un droit qui n'ouvrait rien.
      expect(publies).to.not.contain("admin:write");

      // Et ce scope publié est bien celui qui ouvre : demandé au grant, il rend
      // un jeton que la porte accepte POUR les outils réservés. Un document
      // exact mais inopérant ne serait qu'un autre mensonge.
      const jeton = await jetonPourLaPorte(
        (doc.scopes_supported as string[])[0] ?? null,
      );
      expect(jeton, "grant attendu").toBeTypeOf("string");
      const reponse = await poster(
        { jsonrpc: "2.0", id: 11, method: "tools/list" },
        { authorization: `Bearer ${jeton as string}` },
      );
      expect(outilsDe(reponse).map((t) => t.name)).toContain(
        "nodefony_admin_list",
      );
    });

    it("le chemin publié est celui que la RFC 9728 fait construire au client", async () => {
      // Le client ne devine pas cette URL : il l'assemble par insertion du
      // chemin de la ressource. Si la route était montée ailleurs, elle
      // répondrait parfaitement — à personne.
      expect(MCP_METADATA_PATH).toBe(
        "/.well-known/oauth-protected-resource/nodefony/mcp",
      );
      expect(MCP_METADATA_PATH.endsWith(MCP_ENDPOINT_PATH)).toBe(true);
    });
  },
);
