/**
 * Micro-banc — ce que coûte le vidage du magasin `RequestContext` à la fin
 * d'une unité de travail (#571), comparé à ce qui le précédait.
 *
 * Trois variantes, mesurées sur le MÊME cycle (magasin neuf, identité posée
 * comme le fait le pare-feu, puis nettoyage) — l'écart entre elles est le coût
 * propre du nettoyage :
 *
 * - `avant`    : les 2 affectations de l'ancien `HttpContext.clean()` ;
 * - `release`  : `RequestContext.release(store)` (dist COURANT du cœur) ;
 * - `aucun`    : pas de nettoyage — le plancher du cycle.
 *
 * Plus le surcoût d'une action temps réel décorée : la réaction de vidage posée
 * À CÔTÉ de la promesse rendue (`p.then(release, release)`), contre le retour
 * direct — et contre `Promise.resolve(p).finally`, écarté (~270 ns par appel).
 *
 * Repères relevés à l'écriture : `for…in` sur le magasin ~90 ns, liste parcourue
 * par clé dynamique ~170 ns, liste DÉROULÉE ~0 — c'est elle que porte `release()`.
 *
 * Validité : après `release`, `user`/`token` doivent valoir `undefined` et
 * `requestId` rester — un écart → exit 1, aucun chiffre publié.
 *
 * Il ment dans l'autre sens d'un serveur (tas froid, site monomorphe) :
 * l'arbitre reste la mesure in-situ (`bench-ab-mono.sh`).
 *
 * Usage : node .claude/skills/nodefony-load-test/scripts/micro/micro-store-release.mjs
 */
import { RequestContext } from "nodefony";

const WARM = 2e5;
const N = 2e6;
const RUNS = 7;
const context = {};
const scope = { closed: false };
const user = { id: "u" };
const token = { user };

/** Le magasin tel que `HttpKernel.handleHttp` le pose, puis le pare-feu. */
function makeStore() {
  const store = {
    requestId: "rid",
    scheme: "https",
    traceparent: undefined,
    queries: undefined,
    context,
    scope,
  };
  store.user = user;
  store.token = token;
  return store;
}

const variants = {
  aucun(store) {
    return store;
  },
  avant(store) {
    store.context = undefined;
    store.queries = undefined;
    return store;
  },
  release(store) {
    RequestContext.release(store);
    return store;
  },
};

// Contrôle de validité AVANT toute mesure.
const probe = variants.release(makeStore());
if (
  probe.user !== undefined ||
  probe.token !== undefined ||
  probe.context !== undefined ||
  probe.requestId !== "rid" ||
  probe.scope !== scope
) {
  console.error(
    "✖ release() ne vide pas le magasin comme attendu — rien publié",
  );
  process.exit(1);
}

function measure(fn) {
  let sink = 0;
  for (let i = 0; i < WARM; i++) sink += fn(makeStore()).requestId.length;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) sink += fn(makeStore()).requestId.length;
  const ns = Number(process.hrtime.bigint() - t0) / N;
  if (sink === 0) process.exit(1);
  return ns;
}

const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const out = {};
for (const name of Object.keys(variants)) out[name] = [];
// Variantes ALTERNÉES à chaque run : la dérive de la machine porte sur toutes.
for (let r = 0; r < RUNS; r++) {
  for (const [name, fn] of Object.entries(variants))
    out[name].push(measure(fn));
}
const m = Object.fromEntries(
  Object.entries(out).map(([k, v]) => [k, median(v)]),
);
console.log("cycle complet (ns, médiane de %d runs) :", RUNS);
for (const [k, v] of Object.entries(m))
  console.log(`  ${k.padEnd(8)} ${v.toFixed(1)}`);
console.log(`nettoyage avant   : ${(m.avant - m.aucun).toFixed(1)} ns`);
console.log(`nettoyage release : ${(m.release - m.aucun).toFixed(1)} ns`);
console.log(
  `surcoût #571      : ${(m.release - m.avant).toFixed(1)} ns / unité de travail`,
);

// Action décorée : promesse rendue telle quelle, contre `.finally` qui vide.
async function action() {
  return 1;
}
async function measureAsync(wrap) {
  const M = 5e5;
  for (let i = 0; i < 5e4; i++) await wrap();
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < M; i++) await wrap();
  return Number(process.hrtime.bigint() - t0) / M;
}
const direct = [];
const beside = [];
const fin = [];
for (let r = 0; r < RUNS; r++) {
  direct.push(await measureAsync(() => action()));
  beside.push(
    await measureAsync(() => {
      const store = makeStore();
      const p = action();
      const release = () => RequestContext.release(store);
      p.then(release, release);
      return p;
    }),
  );
  fin.push(
    await measureAsync(() => {
      const store = makeStore();
      return Promise.resolve(action()).finally(() =>
        RequestContext.release(store),
      );
    }),
  );
}
const d = median(direct);
console.log(
  `action décorée    : direct ${d.toFixed(1)} ns · réaction à côté +${(median(beside) - d).toFixed(1)} ns · finally +${(median(fin) - d).toFixed(1)} ns / appel`,
);
