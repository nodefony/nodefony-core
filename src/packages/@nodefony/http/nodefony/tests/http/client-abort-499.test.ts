/// <reference types="node" />
import { expect } from "chai";
import https from "node:https";
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
  },
);
