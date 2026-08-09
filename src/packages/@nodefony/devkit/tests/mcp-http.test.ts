import { describe, it, expect } from "vitest";
import { request as httpsRequest } from "node:https";
import {
  MCP_ENDPOINT_PATH,
  MCP_PROTOCOL_VERSION,
  MCP_SUPPORTED_VERSIONS,
} from "nodefony";

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

/** Réponse brute d'un appel à la porte MCP. */
interface IReponse {
  status: number;
  body: unknown;
  raw: string;
}

/** Poste un message JSON-RPC sur la porte MCP. */
function poster(
  message: unknown,
  headers: Record<string, string> = {},
): Promise<IReponse> {
  return new Promise((resoudre, rejeter) => {
    const charge = JSON.stringify(message);
    const req = httpsRequest(
      `${BASE}${MCP_ENDPOINT_PATH}`,
      {
        method: "POST",
        rejectUnauthorized: false,
        timeout: 8000,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(charge),
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

/** La porte répond-elle — null si oui, la raison sinon. */
async function porteMuette(): Promise<string | null> {
  try {
    const reponse = await poster({ jsonrpc: "2.0", id: 0, method: "ping" });
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

    it("`server/discover` annonce toutes les révisions servies", async () => {
      const reponse = await poster({
        jsonrpc: "2.0",
        id: 7,
        method: "server/discover",
      });
      expect(reponse.status).toBe(200);
      expect(
        (reponse.body as { result: { supportedVersions: string[] } }).result
          .supportedVersions,
      ).toEqual([...MCP_SUPPORTED_VERSIONS]);
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
  },
);
