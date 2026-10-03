/// <reference types="node" />
import { expect } from "vitest";
import https from "node:https";
import http2 from "node:http2";
import { randomUUID } from "node:crypto";
import { IS_PROD_TARGET } from "../helpers/targetEnv";
import {
  compteDansJournal,
  journalDuServeur,
  type IJournalServeur,
} from "../helpers/serverLog";

// P2.3 — internal 499 ("client closed request").
//
// When a client disconnects before ANY response byte is produced, the kernel
// records an internal 499 on the response so the request log + profiler reflect
// the abort instead of a misleading default 200. The 499 is NEVER written to
// the wire (the socket is already dead) — it is observability only, asserted
// here via the server-side request log line ("http 499 GET ...").

const BASE = { hostname: "localhost", port: 5152, rejectUnauthorized: false };

function getJson(path: string): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const req = https.request({ ...BASE, path, method: "GET" }, (res) => {
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode! }));
    });
    req.on("error", reject);
    req.end();
  });
}

// Fires GET /abort/wait (hangs 2s server-side) and destroys the socket after
// `abortAfterMs` < 2000 → client gone before any response → internal 499.
function abortedGet(path: string, abortAfterMs: number): Promise<void> {
  return new Promise((resolve) => {
    const req = https.request({ ...BASE, path, method: "GET" }, (res) => {
      res.resume();
    });
    req.on("error", () => resolve());
    req.on("close", () => resolve());
    req.end();
    setTimeout(() => req.destroy(), abortAfterMs);
  });
}

/**
 * Requête HTTP/2 réelle (un navigateur parle h2 à 5152) — rend le statut reçu.
 * Le client Node `https` parle HTTP/1.1 et ne voit donc pas ce chemin.
 */
function h2Request(
  path: string,
  headers: Record<string, string> = {},
): Promise<number> {
  return new Promise((resolve, reject) => {
    const client = http2.connect("https://localhost:5152", {
      rejectUnauthorized: false,
    });
    client.on("error", reject);
    const req = client.request({ ":path": path, ...headers });
    let status = 0;
    req.on("response", (h) => {
      status = Number(h[":status"]);
    });
    req.resume();
    req.on("close", () => {
      client.close();
      resolve(status);
    });
    req.end();
  });
}

// Dev-only : l'assertion lit la LIGNE DE LOG du 499 (request-logger verbeux en
// dev). En prod le logging diffère → skip (sonde /livez), tourne en dev.
describe.skipIf(IS_PROD_TARGET)(
  "Client abort → internal 499 — P2.3 (requires server)",
  () => {
    // 🔴 Le journal se DÉCOUVRE, il ne se suppose pas : le fichier alimenté
    // dépend de la façon dont le serveur a été lancé (script du dépôt, ou
    // `npx nodefony development` à la main, qui écrit dans `logs/*.jsonl`).
    // Un chemin en dur rendait ici un faux ROUGE — le fichier existait, figé
    // sur un autre jour, et l'absence de 499 accusait le kernel.
    let journal: IJournalServeur | null = null;

    beforeAll(async () => {
      journal = await journalDuServeur(BASE);
    });

    it("aborting before any response is logged as 499, not 200", async (ctx) => {
      const N = 8;
      await Promise.all(
        Array.from({ length: N }, () =>
          abortedGet("/nodefony/test/abort/wait", 100),
        ),
      );
      // Let the close → teardown → logRequest handlers settle.
      await new Promise((r) => setTimeout(r, 500));

      if (journal === null) {
        // Aucun journal atteignable ne porte la trace de CE serveur : on n'a
        // rien mesuré, et le dire vaut mieux qu'un rouge qui accuserait le
        // kernel, comme mieux qu'un vert qui n'aurait rien prouvé.
        ctx.skip(
          "aucun journal alimenté par le serveur sous test (ni logs/*.jsonl, " +
            "ni la redirection du lanceur) — l'assertion 499 n'a rien à lire",
        );
        return;
      }
      // Ligne du journal de requête pour un GET abandonné :
      // "GET  499 https://.../abort/wait ...".
      const found499 = compteDansJournal(
        journal,
        /GET\s+499\s+https?:\/\/\S*\/abort\/wait/,
      );
      expect(
        found499,
        `journal ${journal.chemin} devenu illisible pendant le test`,
      ).to.be.at.least(0);
      expect(
        found499,
        "au moins une ligne de requête '499' attendue au journal",
      ).to.be.at.least(1);
      // Server stays healthy.
      const health = await getJson("/nodefony/test/index");
      expect(health.status).to.equal(200);
    });
    it("HTTP/2 : une réponse terminée SANS corps n'est jamais un 499", async (ctx) => {
      // Sous HTTP/2 la réponse termine le FLUX, pas la réponse de
      // compatibilité : lire son seul `writableEnded` journalisait « client
      // parti » un preflight CORS 204 et une redirection — un WARNING
      // pour une réponse bien reçue.
      const marque = randomUUID();
      const preflight = await h2Request(`/api/hello?m=${marque}`, {
        ":method": "OPTIONS",
        origin: "https://exemple.test",
        "access-control-request-method": "GET",
      });
      const relais = await h2Request(`/_vite/default/@vite/client?m=${marque}`);
      expect(preflight, "prémisse : le preflight répond 204").to.equal(204);
      expect(relais, "prémisse : le relais Vite répond 307").to.equal(307);
      await new Promise((r) => setTimeout(r, 500));
      if (journal === null) {
        ctx.skip("aucun journal alimenté par le serveur sous test");
        return;
      }
      const lignes = (re: RegExp) => compteDansJournal(journal!, re);
      expect(
        lignes(new RegExp(`\\s499\\s\\S*m=${marque}`)),
        "réponse h2 sans corps journalisée 499",
      ).to.equal(0);
      expect(lignes(new RegExp(`OPTIONS\\s+204\\s\\S*m=${marque}`))).to.equal(
        1,
      );
      expect(lignes(new RegExp(`GET\\s+307\\s\\S*m=${marque}`))).to.equal(1);
    });

    it("HTTP/2 : un client parti avant toute réponse reste un 499", async (ctx) => {
      // Le sens inverse du cas précédent, et le seul qui protège le contrôleur :
      // un flux ANNULÉ par le pair (RST_STREAM) a LUI AUSSI
      // `stream.writableEnded === true` — Node termine le côté écriture en le
      // détruisant. Lire ce seul champ prenait un client parti pour une
      // réponse finie : 200 au journal, abandon jamais signalé au contrôleur.
      const marque = randomUUID();
      await new Promise<void>((resolve) => {
        const client = http2.connect("https://localhost:5152", {
          rejectUnauthorized: false,
        });
        client.on("error", () => resolve());
        const req = client.request({
          ":path": `/nodefony/test/abort/wait?m=${marque}`,
        });
        req.on("error", () => undefined);
        req.on("close", () => {
          client.close();
          resolve();
        });
        req.resume();
        req.end();
        setTimeout(() => req.close(http2.constants.NGHTTP2_CANCEL), 100);
      });
      // `/abort/wait` répond à 2 s : on attend qu'il ait fini de travailler.
      await new Promise((r) => setTimeout(r, 2500));
      if (journal === null) {
        ctx.skip("aucun journal alimenté par le serveur sous test");
        return;
      }
      const lignes = (re: RegExp) => compteDansJournal(journal!, re);
      expect(
        lignes(new RegExp(`GET\\s+499\\s\\S*m=${marque}`)),
        "client h2 parti : 499 attendu au journal",
      ).to.equal(1);
      expect(lignes(new RegExp(`GET\\s+200\\s\\S*m=${marque}`))).to.equal(0);
    });
  },
);
