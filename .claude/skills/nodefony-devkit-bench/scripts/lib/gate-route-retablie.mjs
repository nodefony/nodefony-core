#!/usr/bin/env node
/**
 * Juge de la tâche « une route qui répond 404 » — la route en panne
 * répond-elle de nouveau, servie par SON controller ?
 *
 * Le décor : le `prepare` génère un controller (`nodefony create controller`),
 * puis remet `index.ts` dans son état d'avant. Le fichier existe, compile, et
 * rien ne le déclare : la panne la plus fréquente d'une application, celle que
 * `doctor` nomme et qu'une lecture des sources ne voit pas. La bonne réparation
 * tient en deux lignes (l'import et l'entrée de `@controllers([…])`).
 *
 * Ce que le juge exige : `GET <route>` rend `200` et le JSON du controller
 * d'ORIGINE (`hello` qui porte son nom). Une route réécrite ailleurs pour
 * « faire répondre » l'URL rend autre chose — c'est un contournement, et la
 * tâche le refuse. La zone `^/api` du gabarit laisse passer l'anonyme : aucune
 * session n'est requise, et donc aucune n'est présentée.
 *
 * | code | cause                    | qui est en tort                                 |
 * | ---: | ------------------------ | ----------------------------------------------- |
 * |  `0` | conforme                 | —                                               |
 * |  `1` | route-toujours-absente   | l'AGENT — la route répond encore 404            |
 * |  `2` | route-remplacee          | l'AGENT — 200, mais pas le controller d'origine |
 * |  `3` | reponse-inattendue       | l'AGENT — ni 200 ni 404                         |
 * |  `4` | aucune-reponse           | INDÉTERMINÉ — l'application ne répond pas       |
 * |  `5` | port-deja-tenu           | le DÉCOR — serveur étranger                     |
 *
 * @module
 */
import { CookieJar, request, ensurePortFree, exit } from "./http-probe.mjs";
import { CONTROLLER_EN_PANNE, ROUTE_EN_PANNE } from "./enonces.mjs";

await ensurePortFree();

const r = await request("GET", ROUTE_EN_PANNE, new CookieJar(), {
  headers: { accept: "application/json" },
});
if (r.error) exit(4, `CAUSE=aucune-reponse — ${r.error}`);
if (r.status === 404) {
  exit(
    1,
    `CAUSE=route-toujours-absente — GET ${ROUTE_EN_PANNE} rend encore 404 : ` +
      `le controller ${CONTROLLER_EN_PANNE}Controller n'est pas monté.`,
  );
}
if (r.status !== 200) {
  exit(
    3,
    `CAUSE=reponse-inattendue — GET ${ROUTE_EN_PANNE} rend ${r.status} : ${r.body.slice(0, 160)}`,
  );
}
let corps;
try {
  corps = JSON.parse(r.body);
} catch {
  corps = null;
}
const nom = typeof corps?.hello === "string" ? corps.hello : "";
if (nom.toLowerCase() !== CONTROLLER_EN_PANNE.toLowerCase()) {
  exit(
    2,
    `CAUSE=route-remplacee — GET ${ROUTE_EN_PANNE} rend 200, mais pas la réponse de ` +
      `${CONTROLLER_EN_PANNE}Controller (« hello » attendu à « ${CONTROLLER_EN_PANNE} ») : ` +
      r.body.slice(0, 160),
  );
}
console.log(
  `ok — GET ${ROUTE_EN_PANNE} → 200, servie par ${CONTROLLER_EN_PANNE}Controller`,
);
process.exit(0);
