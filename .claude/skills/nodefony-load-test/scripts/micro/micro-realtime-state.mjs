/**
 * Micro-banc — ce que coûte, PAR FRAME entrante, la lecture de l'état realtime
 * d'une connexion selon l'endroit où il vit (#573).
 *
 * `RealtimeController.handleRealtime` lit l'état de la connexion à chaque frame,
 * puis appelle `transport.feed()`. Cet état appartient à la CONNEXION, pas à
 * l'instance du contrôleur (une instance neuve peut servir la même connexion
 * après un `forward`, cf `realtimeScope.test.ts`). Deux façons de le tenir :
 *
 * - `propriete` : une propriété ajoutée APRÈS construction sur le contexte
 *   (`ctx.__nfRealtime`), lue derrière une conversion de type — l'existant ;
 * - `weakmap`   : une `WeakMap<contexte, état>` privée au module, sans
 *   conversion et sans champ ajouté au contexte.
 *
 * Plus l'échelle : le `JSON.parse` d'une frame JSON-RPC courte, que chaque
 * frame paie de toute façon dans le pair. Un écart invisible devant elle ne
 * justifie ni de garder une conversion, ni de refuser la `WeakMap`.
 *
 * Décor : 1 000 connexions vivantes, lues en rotation — une seule connexion
 * laisserait le cache de lecture monomorphe et le tas froid, ce qui flatte les
 * deux variantes.
 *
 * Validité : chaque variante doit rendre l'état de LA connexion lue — un écart
 * → exit 1, aucun chiffre publié.
 *
 * Usage : node .claude/skills/nodefony-load-test/scripts/micro/micro-realtime-state.mjs
 */

const CONNECTIONS = 1000;
const WARM = 2e5;
const N = 4e6;
const RUNS = 7;

/** Contexte factice à champs de classe, comme `WebsocketContext`. */
class FakeWsContext {
  constructor(i) {
    this.id = i;
    this.connection = null;
    this.requestId = `rid-${i}`;
    this.type = "websocket";
  }
}

const states = new WeakMap();
const contexts = [];
for (let i = 0; i < CONNECTIONS; i++) {
  const ctx = new FakeWsContext(i);
  const state = { welcomed: true, transport: { fed: i } };
  ctx.__nfRealtime = state; // ajoutée après construction, comme aujourd'hui
  states.set(ctx, state);
  contexts.push(ctx);
}

const variants = {
  propriete(ctx) {
    return ctx.__nfRealtime?.transport.fed;
  },
  weakmap(ctx) {
    return states.get(ctx)?.transport.fed;
  },
};

// Contrôle de validité AVANT toute mesure.
for (const [name, fn] of Object.entries(variants)) {
  for (let i = 0; i < CONNECTIONS; i++) {
    if (fn(contexts[i]) !== i) {
      console.error(
        `✖ ${name} ne rend pas l'état de la connexion lue — rien publié`,
      );
      process.exit(1);
    }
  }
}

function measure(fn) {
  let sink = 0;
  for (let i = 0; i < WARM; i++) sink += fn(contexts[i % CONNECTIONS]);
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) sink += fn(contexts[i % CONNECTIONS]);
  const ns = Number(process.hrtime.bigint() - t0) / N;
  if (sink === 0) process.exit(1);
  return ns;
}

const frame =
  '{"jsonrpc":"2.0","id":17,"method":"chat:send","params":{"room":"r1","text":"bonjour"}}';
function measureParse() {
  const M = 1e6;
  let sink = 0;
  for (let i = 0; i < 1e5; i++) sink += JSON.parse(frame).id;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < M; i++) sink += JSON.parse(frame).id;
  const ns = Number(process.hrtime.bigint() - t0) / M;
  if (sink === 0) process.exit(1);
  return ns;
}

const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const out = { propriete: [], weakmap: [], parse: [] };
// Variantes ALTERNÉES à chaque run : la dérive de la machine porte sur toutes.
for (let r = 0; r < RUNS; r++) {
  for (const [name, fn] of Object.entries(variants))
    out[name].push(measure(fn));
  out.parse.push(measureParse());
}
const m = Object.fromEntries(
  Object.entries(out).map(([k, v]) => [k, median(v)]),
);
console.log(
  "lecture de l'état par frame (ns, médiane de %d runs, %d connexions) :",
  RUNS,
  CONNECTIONS,
);
console.log(`  propriete ${m.propriete.toFixed(1)}`);
console.log(`  weakmap   ${m.weakmap.toFixed(1)}`);
console.log(`  écart     ${(m.weakmap - m.propriete).toFixed(1)} ns / frame`);
console.log(
  `échelle — JSON.parse d'une frame courte : ${m.parse.toFixed(1)} ns`,
);
console.log(
  `écart rapporté au parse : ${(((m.weakmap - m.propriete) / m.parse) * 100).toFixed(2)} %`,
);
