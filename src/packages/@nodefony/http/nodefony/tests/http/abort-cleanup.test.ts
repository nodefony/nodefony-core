/// <reference types="node" />
import { expect } from "chai";
import https from "node:https";
import {
  compteDansJournal,
  journalDuServeur,
  type IJournalServeur,
} from "../helpers/serverLog";

// Regression coverage for the "Response Already sended" CRITIC noise that
// fired on /abort/wait when the client closed the socket while the
// controller was still waiting on its AbortSignal.
//
// Race:
//   1. response "close" → http-kernel.onClose → _abortIfPending + teardown
//      (flips `context.finished = true` and logs the request).
//   2. Controller's signal listener rejects → catch → renderJson(...).
//   3. HttpContext.send sees `finished === true` and used to throw
//      "Response Already sended" → onError tried to render → re-throw → CRITIC.
//
// Expected after the fix: 0 CRITIC, server stays healthy, abortedCount
// matches the number of aborted requests we issued.

const BASE = { hostname: "localhost", port: 5152, rejectUnauthorized: false };

function getJson(path: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = https.request({ ...BASE, path, method: "GET" }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString();
        try {
          resolve({ status: res.statusCode!, body: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode!, body: raw });
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

/**
 * Ce qu'une requête censée être ABANDONNÉE a réellement vécu.
 *
 * 🔴 L'ancienne version résolvait sur `error` ET sur `close` en ne rendant
 * RIEN. Une requête qui recevait une RÉPONSE avant l'abandon — un refus
 * immédiat, une redirection, n'importe quel statut arrivant en moins de
 * `abortAfterMs` — était donc comptée comme abandonnée par le test, alors que
 * le serveur n'avait jamais vu d'abandon. L'échec qui en résultait, « expected
 * 1 to equal 20 », ne pouvait désigner ni la cause ni même le nombre de
 * requêtes réellement parties : dix-neuf disparitions muettes.
 */
type IssueRequete =
  | { issue: "abandon" }
  | { issue: "statut"; code: number }
  | { issue: "erreur"; message: string };

/**
 * Lance GET /abort/wait et rend de quoi la couper QUAND ON VEUT.
 *
 * 🔴 L'ancienne forme coupait après un délai fixe, en SUPPOSANT que la requête
 * était déjà entrée dans l'action. Le compteur du serveur ne peut compter que
 * ce que l'action VOIT — une requête coupée pendant sa poignée de main TLS ou
 * son routage n'est comptée nulle part, et c'est légitime. Vécu : 20 lancées,
 * 20 abandonnées côté client, **9 comptées** côté serveur sur un exécuteur
 * macOS en mode production. Le banc accusait le serveur de perdre des abandons
 * qu'il n'avait jamais reçus.
 *
 * L'appelant coupe donc APRÈS avoir CONSTATÉ que les N requêtes sont en vol.
 * La route attend 2 s côté serveur : la fenêtre est large.
 */
function lancerAbandon(path: string): {
  issue: Promise<IssueRequete>;
  couper: () => void;
} {
  let couper = (): void => {};
  const issue = new Promise<IssueRequete>((resolve) => {
    let vu: IssueRequete = { issue: "abandon" };
    const req = https.request({ ...BASE, path, method: "GET" }, (res) => {
      // Une réponse est arrivée : cette requête n'a PAS été abandonnée, quoi
      // qu'il advienne du socket ensuite.
      vu = { issue: "statut", code: res.statusCode ?? 0 };
      res.resume();
    });
    req.on("error", (e: Error) => {
      // `destroy()` provoque lui-même une erreur : ne pas écraser un statut
      // déjà observé, et ne pas confondre l'abandon voulu avec une panne.
      if (vu.issue === "abandon") {
        vu = /aborted|socket hang up|ECONNRESET/i.test(e.message)
          ? { issue: "abandon" }
          : { issue: "erreur", message: e.message };
      }
      resolve(vu);
    });
    req.on("close", () => resolve(vu));
    req.end();
    couper = () => req.destroy();
  });
  return { issue, couper };
}

/**
 * Attend que N requêtes soient EFFECTIVEMENT dans l'action — la garde qui
 * remplace le délai deviné. Rend ce qu'elle a vu, pour que l'échec le cite.
 */
async function attendreEnVol(
  cible: number,
  plafondMs = 10000,
): Promise<number> {
  const debut = Date.now();
  let vues = -1;
  while (Date.now() - debut < plafondMs) {
    const state = await getJson("/nodefony/test/abort/state");
    const brut = (state.body as { inflightCount?: number }).inflightCount;
    // 🔴 Champ ABSENT ≠ zéro requête en vol. Un serveur bâti avant que cette
    // sonde existe rend `undefined`, et confondre les deux ferait accuser le
    // produit d'un décor périmé — vécu à la première exécution de ce cas.
    if (typeof brut !== "number") {
      throw new Error(
        "le serveur sous test ne publie pas `inflightCount` sur " +
          "/nodefony/test/abort/state — son dist est ANTÉRIEUR à cette sonde. " +
          "Reconstruire le module de test et relancer le serveur.",
      );
    }
    vues = brut;
    if (vues >= cible) return vues;
    await new Promise((r) => setTimeout(r, 25));
  }
  return vues;
}

/** Répartition lisible des issues — ce que l'assertion doit pouvoir citer. */
function resume(issues: IssueRequete[]): string {
  const parts: string[] = [];
  const abandons = issues.filter((i) => i.issue === "abandon").length;
  if (abandons) parts.push(`${abandons} abandon(s)`);
  const statuts = issues.filter(
    (i): i is { issue: "statut"; code: number } => i.issue === "statut",
  );
  for (const code of new Set(statuts.map((i) => i.code))) {
    parts.push(
      `${statuts.filter((i) => i.code === code).length}× statut ${code}`,
    );
  }
  const erreurs = issues.filter(
    (i): i is { issue: "erreur"; message: string } => i.issue === "erreur",
  );
  for (const m of new Set(erreurs.map((i) => i.message))) {
    parts.push(`${erreurs.filter((i) => i.message === m).length}× « ${m} »`);
  }
  return parts.join(" · ") || "aucune";
}

/**
 * Attend que le compteur d'abandons ATTEIGNE sa cible, au lieu de dormir.
 *
 * Un `setTimeout(500)` fixe ne mesure que la machine : il tenait sur un poste
 * et pas sur un exécuteur partagé. Ce qu'on veut savoir est que le serveur
 * finit par tous les voir — pas qu'il les voie en moins d'une demi-seconde.
 * Le plafond reste très au-dessus du bruit et l'assertion, elle, n'est PAS
 * relâchée : c'est toujours l'égalité exacte qui est exigée ensuite.
 */
async function attendreCompteur(
  cible: number,
  plafondMs = 8000,
): Promise<{ abortedCount: number; completedCount: number }> {
  const debut = Date.now();
  let dernier = { abortedCount: -1, completedCount: -1 };
  while (Date.now() - debut < plafondMs) {
    const state = await getJson("/nodefony/test/abort/state");
    dernier = state.body as typeof dernier;
    if (dernier.abortedCount >= cible) return dernier;
    await new Promise((r) => setTimeout(r, 50));
  }
  return dernier;
}

describe("Abort cleanup — no CRITIC on client disconnect (requires server)", () => {
  // 🔴 Le journal se DÉCOUVRE (cf `helpers/serverLog`). Le chemin en dur qui
  // vivait ici rendait un faux VERT : l'assertion est NÉGATIVE (« aucun CRITIC »),
  // et un fichier figé n'en contient évidemment aucun — la garde passait sans
  // avoir rien lu du serveur sous test.
  let journal: IJournalServeur | null = null;

  beforeAll(async () => {
    journal = await journalDuServeur(BASE);
    // Reset server-side counters so the assertion is deterministic.
    await getJson("/nodefony/test/abort/reset");
  });

  it("10 client aborts mid-wait → server stays alive, no Response Already sended", async (ctx) => {
    const N = 10;
    // Lancer, CONSTATER qu'elles sont toutes dans l'action, PUIS couper.
    const vols = Array.from({ length: N }, () =>
      lancerAbandon("/nodefony/test/abort/wait"),
    );
    const enVol = await attendreEnVol(N);
    expect(
      enVol,
      `les ${N} requêtes doivent être DANS l'action avant d'être coupées ` +
        `(sinon le serveur ne peut pas les compter, et ce n'est pas un défaut)`,
    ).to.equal(N);
    for (const v of vols) v.couper();
    const issues = await Promise.all(vols.map((v) => v.issue));
    const compteurs = await attendreCompteur(N);

    // Server still serves requests.
    const health = await getJson("/nodefony/test/index");
    expect(health.status).to.equal(200);

    // All aborts were observed by the controller.
    expect(compteurs.abortedCount, `côté client : ${resume(issues)}`).to.equal(
      N,
    );
    expect(compteurs.completedCount).to.equal(0);

    // Best-effort: the kernel log MUST NOT contain the "Response Already
    // sended" CRITIC line for these aborts. Skip silently if the log file is
    // not accessible (e.g. CI runs without the dev launcher).
    if (journal === null) {
      ctx.skip(
        "aucun journal alimenté par le serveur sous test — l'absence de CRITIC " +
          "n'aurait rien prouvé",
      );
      return;
    }
    const count = compteDansJournal(
      journal,
      /CRITIC HttpKernel\s*:.*Response Already sended/,
    );
    expect(count, `journal ${journal.chemin} illisible`).to.be.at.least(0);
    expect(
      count,
      "aucune ligne CRITIC 'Response Already sended' attendue",
    ).to.equal(0);
  });

  it("burst of 20 aborts then a clean request — counters consistent", async () => {
    await getJson("/nodefony/test/abort/reset");
    const N = 20;
    const vols = Array.from({ length: N }, () =>
      lancerAbandon("/nodefony/test/abort/wait"),
    );
    const enVol = await attendreEnVol(N);
    expect(
      enVol,
      `les ${N} requêtes doivent être DANS l'action avant d'être coupées`,
    ).to.equal(N);
    for (const v of vols) v.couper();
    const issues = await Promise.all(vols.map((v) => v.issue));
    const compteurs = await attendreCompteur(N);

    expect(compteurs.abortedCount, `côté client : ${resume(issues)}`).to.equal(
      N,
    );

    const ok = await getJson("/nodefony/test/index");
    expect(ok.status).to.equal(200);
  });
});
