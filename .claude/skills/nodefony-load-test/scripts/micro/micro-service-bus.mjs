/**
 * Micro-banc — ce que coûte un `Service` construit dans un scope de requête
 * (le cas de chaque `Context`) : constructeur + ce que le pipeline fait ensuite
 * sur son bus quand personne n'y est abonné (`fire("onRequest")`, gardes
 * `listenerCount`).
 *
 * Importe `nodefony` — donc le dist COURANT du cœur. Comparer AVANT/APRÈS dans
 * la même fenêtre : bascule du source + rebuild du cœur après CHAQUE bascule
 * (le dist ne suit pas le stash).
 *
 * Validité : chaque cycle vérifie que le service a bien reçu le scope ; un
 * écart → exit 1, aucun chiffre publié.
 *
 * Il ment dans l'autre sens d'un serveur (tas froid, site monomorphe) :
 * l'arbitre reste la mesure in-situ (`wait-compare.sh`).
 *
 * Usage : node .claude/skills/nodefony-load-test/scripts/micro/micro-service-bus.mjs
 */
import { Container, Service, Syslog } from "nodefony";

// Décor d'un serveur : syslog posé sur le conteneur racine, scope `request`
// déclaré — sinon chaque Service fabriquerait son propre Syslog.
const root = new Container();
root.set("syslog", new Syslog());
root.addScope("request");
const WARM = 1e5;
const N = 5e5;
const RUNS = 5;

function cycle() {
  const scope = root.enterScope("request");
  const svc = new Service("http", scope);
  svc.fire("onRequest", svc);
  const n =
    svc.listenerCount("onTimeout") +
    svc.listenerCount("onSend") +
    svc.listenerCount("onClose") +
    svc.listenerCount("onFinish");
  root.leaveScope(scope);
  if (svc.container !== scope || n !== 0) {
    console.error("cycle invalide : scope non reçu ou abonné fantôme");
    process.exit(1);
  }
}

for (let i = 0; i < WARM; i++) cycle();
const runs = [];
for (let r = 0; r < RUNS; r++) {
  const t = process.hrtime.bigint();
  for (let i = 0; i < N; i++) cycle();
  runs.push(Number(process.hrtime.bigint() - t) / N);
}
runs.sort((a, b) => a - b);
const med = runs[RUNS >> 1];
const spread = ((runs[RUNS - 1] - runs[0]) / med) * 100;
console.log(
  `Service dans un scope + bus sans abonné : ${med.toFixed(0)} ns/cycle (dispersion ${spread.toFixed(1)} %)`,
);
