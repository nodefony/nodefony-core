/// <reference types="node" />
/**
 * Budget d'évènements asynchrones d'une requête GET (#505, levier L2).
 *
 * Démarre un exemplaire `production` JETABLE (`startSpareApp`, ports à part :
 * le serveur de dev du décor reste intact) avec le compteur de Promises
 * préchargé, puis compte ce que le pipeline crée pour servir UN GET sur la
 * cible de banc (`/nodefony/kernel/bench`, montée par `NF_BENCH_ROUTE=1`).
 * Mesure EXACTE et indépendante de la machine : le même chemin crée le même
 * nombre de Promises, quel que soit le processeur.
 *
 * Ce que le chiffre compte (cf `helpers/promiseCounter.mjs`) : les Promises
 * PLUS une par `await` — V8 n'alloue la Promise jetable d'un `await` que sous
 * crochet. Même instrument, même route, même travail de sécurité : le témoin
 * équitable `nest-fair` (NestJS + Fastify) en crée 20, Fastify nu 2, Express
 * 0. Nodefony en créait 57, dont aucune pour ses contrôles (synchrones) —
 * toutes pour la TUYAUTERIE, des étapes `async` qui n'attendaient rien. Chaque
 * étape rend désormais sa valeur quand rien n'est attendu, jusqu'à l'API
 * d'envoi : ce GET n'en crée plus AUCUNE.
 *
 * Le budget est donc ZÉRO. Ce n'est pas un seuil de confort : le compte est
 * exact, et une Promise qui réapparaît sur ce chemin doit être une DÉCISION —
 * relever le budget dans le même diff, avec sa raison. La valeur par requête
 * est arrondie : un minuteur de fond qui tombe dans la fenêtre ajoute une
 * fraction (quelques Promises sur 200 requêtes), une Promise ajoutée au
 * pipeline — même une requête sur deux — ajoute au moins 0,5.
 *
 * Un contrôle qui ne dépasse jamais, c'est un contrôle qui ne mesure rien, et à
 * zéro un compteur muet rendrait le même vert : le cas vérifie d'abord que le
 * compteur voit les Promises d'une requête qui en crée forcément (un 404, rendu
 * par `onError`, asynchrone).
 *
 * Débrancher pour le voir rougir : rendre de nouveau `async` une étape rendue
 * synchrone (`HttpContext.send`, `HttpKernel.handleHttp`…).
 */
import { expect } from "chai";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startSpareApp } from "nodefony/testing";

/** Aucun évènement asynchrone sur le GET nominal — cf l'en-tête. */
const BUDGET = 0;
const HTTP_PORT = 5397;
const HTTPS_PORT = 5396;
const COUNTER_PORT = 5398;
const TARGET = `http://127.0.0.1:${HTTP_PORT}/nodefony/kernel/bench`;
/** Témoin positif : une route absente, rendue en 404 par `onError` (asynchrone). */
const MISSING = `http://127.0.0.1:${HTTP_PORT}/nodefony/kernel/bench-absent`;
const REQUESTS = 200;

const REPO_ROOT = fileURLToPath(
  new URL("../../../../../../../", import.meta.url),
);
const COUNTER = pathToFileURL(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../helpers/promiseCounter.mjs",
  ),
).href;

async function readCounter(): Promise<number> {
  const res = await fetch(`http://127.0.0.1:${COUNTER_PORT}/`);
  const value = Number(await res.text());
  if (!Number.isFinite(value)) {
    throw new Error(`compteur illisible : ${value}`);
  }
  return value;
}

async function hit(url: string, status: number, times: number): Promise<void> {
  for (let i = 0; i < times; i++) {
    const res = await fetch(url);
    // Consommer le corps : une réponse non lue garde la connexion occupée.
    await res.arrayBuffer();
    if (res.status !== status) {
      throw new Error(`${url} a répondu ${res.status}, attendu ${status}`);
    }
  }
}

describe("Budget de Promises — un GET en production (#505)", function () {
  it(`un GET crée au plus ${BUDGET} évènement asynchrone`, async function () {
    const app = await startSpareApp({
      port: HTTP_PORT,
      httpsPort: HTTPS_PORT,
      root: REPO_ROOT,
      env: {
        NODE_ENV: "production",
        NF_LOG_DRIVER: "null",
        NF_BENCH_ROUTE: "1",
        NF_PROMISE_COUNTER_PORT: String(COUNTER_PORT),
        NODE_OPTIONS:
          `${process.env.NODE_OPTIONS ?? ""} --import=${COUNTER}`.trim(),
      },
    });
    try {
      // Chauffe : singleton du contrôleur, caches paresseux, JIT — le régime
      // mesuré est celui d'une requête ordinaire, pas de la première.
      await hit(TARGET, 200, 50);
      await hit(MISSING, 404, 10);
      const control = await readCounter();
      await hit(MISSING, 404, 10);
      const seen = (await readCounter()) - control;
      expect(
        seen,
        "le compteur doit voir les Promises d'une requête qui en crée (404)",
      ).to.be.greaterThan(0);
      const before = await readCounter();
      await hit(TARGET, 200, REQUESTS);
      const after = await readCounter();
      const perRequest = (after - before) / REQUESTS;
      console.log(
        `      évènements asynchrones par GET : ${perRequest.toFixed(2)} (budget ${BUDGET} ; témoins : Express 0, Fastify nu 2, nest-fair 20)`,
      );
      expect(Math.round(perRequest)).to.be.at.most(BUDGET);
    } finally {
      await app.stop();
    }
  });
});
