/**
 * La PRÉMISSE d'IDENTITÉ d'une tâche de sécurité — constatée AVANT l'agent.
 *
 * ## Le défaut que ce module ferme
 *
 * Huit juges du banc de découvrabilité ouvrent une session `admin` pour mesurer
 * une protection. Quand ce compte n'est pas joignable, ils rendent un rouge de
 * DÉCOR — la bonne conduite, mais trop tard : la tâche a été jouée, l'agent
 * payé, et le run est inutilisable pour cette tâche. On aura payé un verdict
 * qu'on savait d'avance ne pas pouvoir rendre.
 *
 * La garde existait, écrite pour UNE seule tâche (le mode `--decor` du juge du
 * champ utilisateur), et son propre commentaire disait pourquoi : « mieux vaut
 * une tâche non jouée qu'un rouge imputé à tort ». La leçon avait été tirée à un
 * endroit et pas portée aux sept autres.
 *
 * ## Pourquoi une session, et pas une lecture en base
 *
 * Parce que le cas qui a vidé les huit juges ne se voyait pas en base : le
 * compte `admin` existait, et c'est le MOT DE PASSE que le banc présentait qui
 * n'était plus le bon. Une lecture de table aurait dit « le décor est là » et
 * l'agent aurait été payé quand même. La prémisse fait donc le geste que le juge
 * fera — ouvrir une session.
 *
 * ## Pourquoi les dépendances sont INJECTÉES
 *
 * Une fonction qui lit `process.env`, lance `npx` et sonde un port ne s'éprouve
 * que sur un décor complet — c'est-à-dire jamais, et la garde resterait une
 * promesse. Démarrage, arrêt, attente et constatation entrent donc par
 * paramètre : l'auto-contrôle les remplace par des témoins et voit la règle
 * mordre en une seconde.
 *
 * @module
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { appPortUnderTest } from "./http-probe.mjs";
import { needsShell } from "./exec-portable.mjs";

/** Le module d'identités, lancé en mode `--constater` — chemin ABSOLU. */
export const IDENTITES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "identites.mjs",
);

/**
 * Attend que le port soit RENDU, pas seulement que l'arrêt ait répondu.
 *
 * `nodefony stop` rend la main avant que le système ait libéré l'écoute : la
 * tâche suivante — ou l'agent — retrouverait un port occupé par un serveur
 * mourant, et l'échec ne dirait rien de ce qu'on mesure.
 *
 * @param {string|number} port - le port à voir se libérer.
 * @returns {boolean} `true` si le port est libre, `false` au bout de 10 s.
 */
export function attendrePortLibere(port) {
  // Une SEULE commande qui boucle, plutôt qu'un process par tentative : la
  // sonde coûterait plus cher que l'attente qu'elle mesure.
  const r = spawnSync(
    process.execPath,
    [
      "-e",
      `const net=require("node:net");let n=0;const essai=()=>{` +
        `const s=net.connect(${Number(port)},"127.0.0.1");` +
        `s.on("connect",()=>{s.destroy();if(++n>40)process.exit(1);setTimeout(essai,250)});` +
        `s.on("error",()=>process.exit(0))};essai();`,
    ],
    { encoding: "utf8", timeout: 20_000 },
  );
  return r.status === 0;
}

/**
 * Constate que le compte administrateur ouvre une session — ou dit pourquoi non.
 *
 * Le décor est laissé DANS L'ÉTAT OÙ ON L'A TROUVÉ : l'application n'est
 * arrêtée que si c'est nous qui l'avons démarrée. En régime `eteint` — le
 * défaut du banc — l'agent doit trouver une application à l'arrêt, et une
 * prémisse qui la laisserait en marche changerait ce que la tâche mesure.
 *
 * @param {object} decor - le décor de la tâche.
 * @param {string} decor.app - racine de l'application témoin.
 * @param {string|number} decor.port - le port sur lequel elle sert.
 * @param {Record<string, string|undefined>} decor.env - l'environnement du décor.
 * @param {(app: string, env: object) => boolean} [decor.demarrer] - démarre
 *   l'application ; rend `true` si c'est bien NOUS qui l'avons démarrée.
 * @param {(app: string, env: object) => void} [decor.arreter] - l'arrête.
 * @param {(app: string, env: object) => {status: number|null, sortie: string}}
 *   [decor.constater] - ouvre la session et rend le verdict.
 * @param {(port: string|number) => boolean} [decor.attendre] - attend la
 *   libération du port.
 * @returns {{ok: boolean, detail: string, demarreeIci: boolean}} le verdict, ce
 *   que la sonde a dit, et si l'application a été démarrée par nous.
 */
export function constaterPremisseIdentite({
  app,
  port,
  env,
  demarrer = demarrerParDefaut,
  arreter = arreterParDefaut,
  constater = constaterParDefaut,
  attendre = attendrePortLibere,
}) {
  const deja = appPortUnderTest(port, app).sien;
  const demarreeIci = deja ? false : demarrer(app, env);
  const c = constater(app, env);
  if (demarreeIci) {
    arreter(app, env);
    attendre(port);
  }
  return {
    ok: c.status === 0,
    detail: (c.sortie ?? "").trim().replace(/\s+/gu, " ").slice(0, 240),
    demarreeIci,
  };
}

/**
 * Démarre l'application témoin en développement, détachée.
 *
 * @param {string} app - racine de l'application.
 * @param {object} env - environnement du décor.
 * @returns {boolean} `true` si c'est nous qui l'avons démarrée.
 */
function demarrerParDefaut(app, env) {
  const d = spawnSync(
    "npx",
    ["--no-install", "nodefony", "development", "--detach", "--wait"],
    {
      shell: needsShell("npx"),
      cwd: app,
      encoding: "utf8",
      env,
      timeout: 180_000,
    },
  );
  // 69 (« port occupé ») : quelqu'un d'autre écoute. On ne l'a pas démarrée,
  // donc on ne l'arrêtera pas — et la constatation dira si c'est la bonne.
  return d.status === 0;
}

/**
 * Arrête l'application témoin.
 *
 * @param {string} app - racine de l'application.
 * @param {object} env - environnement du décor.
 * @returns {void}
 */
function arreterParDefaut(app, env) {
  spawnSync("npx", ["--no-install", "nodefony", "stop"], {
    shell: needsShell("npx"),
    cwd: app,
    encoding: "utf8",
    env,
    timeout: 60_000,
  });
}

/**
 * Ouvre la session d'administration par le module d'IDENTITÉS — celui-là même
 * dont les juges se servent : une seule implémentation de « qui est admin ».
 *
 * @param {string} app - racine de l'application.
 * @param {object} env - environnement du décor.
 * @returns {{status: number|null, sortie: string}} le code et ce qui a été dit.
 */
function constaterParDefaut(app, env) {
  const c = spawnSync(process.execPath, [IDENTITES, "--constater"], {
    cwd: app,
    encoding: "utf8",
    env,
    timeout: 60_000,
  });
  return { status: c.status, sortie: c.stderr || c.stdout || "" };
}
