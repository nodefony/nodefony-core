/**
 * Compteur de Promises d'un processus, préchargé par `node --import` (ou
 * `NODE_OPTIONS=--import=<url>`) — l'instrument du budget de Promises (#505).
 *
 * Il compte chaque `init` de Promise que V8 déclare (`v8.promiseHooks.onInit`)
 * et sert le total en texte sur `127.0.0.1:<NF_PROMISE_COUNTER_PORT>` (défaut
 * 5199), par un serveur à callbacks qui n'en crée aucune lui-même.
 *
 * ⚠️ CE QU'IL COMPTE — étalonné, à dire avec le chiffre : les Promises créées
 * PLUS une par `await`. V8 n'alloue cette « Promise jetable » d'un `await` que
 * lorsqu'un crochet est branché ; sans crochet, elle n'existe pas. Étalonnage :
 * `Promise.resolve()` → 1 ; `await` d'une fonction async vide → 2 ; trois
 * fonctions async imbriquées qui s'attendent → 6. Le chiffre se lit donc
 * « évènements asynchrones » (Promises + suspensions), et ne se compare qu'à un
 * autre camp mesuré par CE MÊME instrument.
 *
 * Le crochet ralentit le processus (chemins lents de V8) : jamais sur un banc
 * de débit ou de latence, seulement pour compter.
 */
import { promiseHooks } from "node:v8";
import http from "node:http";

let count = 0;
promiseHooks.onInit(() => {
  count++;
});

const port = Number(process.env.NF_PROMISE_COUNTER_PORT ?? 5199);
const server = http.createServer((_req, res) => {
  res.end(String(count));
});
server.on("error", (error) => {
  // Port pris : le compteur se tait plutôt que de tuer le processus mesuré —
  // la garde qui le lit échouera en le disant (compteur injoignable).
  console.error(`[promiseCounter] port ${port} : ${error.message}`);
});
server.listen(port, "127.0.0.1");
server.unref();
