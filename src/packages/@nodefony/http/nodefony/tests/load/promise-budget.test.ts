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
 * équitable `nest-fair` (NestJS + Fastify) en crée 20 ; Nodefony en créait 57,
 * dont aucune pour ses contrôles (synchrones) — toutes pour la TUYAUTERIE, des
 * étapes `async` qui n'attendaient rien.
 *
 * Le budget est la parité avec ce témoin. Un contrôle qui ne dépasse jamais,
 * c'est un contrôle qui ne mesure rien : le cas vérifie d'abord que le compteur
 * répond et compte (un préchargement ignoré rendrait 0, donc un vert vide).
 *
 * Débrancher pour le voir rougir : rendre de nouveau `async` une étape rendue
 * synchrone (`HttpRequest.initialize`, `HttpKernel.startSession`…).
 */
import { expect } from "chai";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startSpareApp } from "nodefony/testing";

/** Parité avec le témoin équitable `nest-fair`, mesuré par le même compteur. */
const BUDGET = 20;
const HTTP_PORT = 5397;
const HTTPS_PORT = 5396;
const COUNTER_PORT = 5398;
const TARGET = `http://127.0.0.1:${HTTP_PORT}/nodefony/kernel/bench`;
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

async function hitTarget(times: number): Promise<void> {
  for (let i = 0; i < times; i++) {
    const res = await fetch(TARGET);
    // Consommer le corps : une réponse non lue garde la connexion occupée.
    await res.arrayBuffer();
    if (res.status !== 200) {
      throw new Error(`${TARGET} a répondu ${res.status}`);
    }
  }
}

describe("Budget de Promises — un GET en production (#505)", function () {
  it(`un GET crée au plus ${BUDGET} évènements asynchrones (parité nest-fair)`, async function () {
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
      await hitTarget(50);
      const before = await readCounter();
      await hitTarget(REQUESTS);
      const after = await readCounter();
      const perRequest = (after - before) / REQUESTS;
      console.log(
        `      évènements asynchrones par GET : ${perRequest.toFixed(2)} (budget ${BUDGET}, témoin nest-fair 20)`,
      );
      expect(
        before,
        "le compteur doit avoir compté pendant la chauffe",
      ).to.be.greaterThan(0);
      expect(
        perRequest,
        "le compteur doit voir les requêtes mesurées",
      ).to.be.greaterThan(0);
      expect(perRequest).to.be.at.most(BUDGET);
    } finally {
      await app.stop();
    }
  });
});
