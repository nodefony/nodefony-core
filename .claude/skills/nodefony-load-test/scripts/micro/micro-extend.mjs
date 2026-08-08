// Micro-bench isolé — coût du merge d'options du chemin session.
// Hypothèse testée : `extend` (Tools) est un site MÉGAMORPHE (appelé partout avec
// des dizaines de formes) → ses accès dynamiques dégénèrent en lookups dictionnaire.
// Comparaison : extend monomorphe / extend mégamorphe / spread objet.
//
// Usage : node .claude/skills/nodefony-load-test/scripts/micro/micro-extend.mjs
import { extend } from "nodefony";

const N = 200_000;

// Formes RÉELLES du chemin session (config http : 9 clés + cookie imbriqué)
const defaultSessionOptions = {
  name: "nodefony",
  strictMode: true,
  refererCheck: false,
};

const serviceOptions = {
  strictMode: true,
  name: "nodefony",
  store: "auto",
  gcIntervalS: 600,
  gcJitter: true,
  idleTimeoutS: 1800,
  absoluteTimeoutS: 43200,
  refererCheck: false,
  cookie: {
    path: "/",
    httpOnly: true,
    secure: false,
    sameSite: "Lax",
    maxAge: 0,
    domain: undefined,
  },
};

// Formes PARASITES : ce qui pollue l'IC d'extend dans le vrai runtime
// (cookie.ts, parser.ts, certificates.ts, server-static.ts, http2/Response.ts…)
const decoys = [
  { path: "/", httpOnly: true, secure: true, sameSite: "Strict" },
  { a: 1, b: 2 },
  { key: "x", cert: "y", ca: "z", requestCert: false },
  { index: ["index.html"], maxAge: 0, redirect: true, dotfiles: "ignore" },
  { ":status": 200, "content-type": "application/json" },
  { q: "1", page: "2", sort: "name" },
  { host: "localhost", port: 5151, protocol: "http:" },
  { nbListeners: 60 },
  { foo: "bar", baz: 42, qux: null },
  { alpha: 1, beta: 2, gamma: 3, delta: 4, epsilon: 5 },
];

function bench(label, fn) {
  // warmup
  for (let i = 0; i < 20_000; i++) fn(i);
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) fn(i);
  const t1 = process.hrtime.bigint();
  const nsPerOp = Number(t1 - t0) / N;
  console.log(`${label.padEnd(46)} ${nsPerOp.toFixed(1).padStart(8)} ns/op`);
  return nsPerOp;
}

console.log(`\n=== Séquence RÉELLE du chemin session (2 merges/req) ===`);
console.log(`Node ${process.version} — ${N} itérations\n`);

// 1. Séquence actuelle : createSession() puis ctor Session()
const a = bench("extend ×2 (actuel, site monomorphe)", () => {
  const o = extend({}, serviceOptions, undefined);
  return extend({}, defaultSessionOptions, o);
});

// 2. Même séquence, site d'extend POLLUÉ par les autres appelants du framework
let d = 0;
const b = bench("extend ×2 (actuel, site MÉGAMORPHE)", () => {
  // 1 appel parasite par itération = ce que fait le vrai runtime entre 2 requêtes
  extend({}, decoys[d++ % decoys.length], decoys[(d + 3) % decoys.length]);
  const o = extend({}, serviceOptions, undefined);
  return extend({}, defaultSessionOptions, o);
});

// 3. Geste proposé : spread objet (intrinsèque V8)
const c = bench("spread ×2 (proposé)", () => {
  const o = { ...serviceOptions };
  return { ...defaultSessionOptions, ...o };
});

// 4. Spread avec le même parasite (contrôle d'équité)
d = 0;
const e = bench("spread ×2 (proposé, avec parasite extend)", () => {
  extend({}, decoys[d++ % decoys.length], decoys[(d + 3) % decoys.length]);
  const o = { ...serviceOptions };
  return { ...defaultSessionOptions, ...o };
});

// 5. Borne basse absolue : 1 seul merge mémoïsé
const f = bench("spread ×1 (mémoïsé, borne basse)", () => {
  return { ...serviceOptions };
});

console.log(`\n--- Verdict (par requête) ---`);
console.log(`gain spread vs extend, monomorphe : ${(a - c).toFixed(1)} ns`);
console.log(
  `gain spread vs extend, mégamorphe : ${(b - e).toFixed(1)} ns  ← le cas réel`,
);
console.log(
  `part mégamorphie dans extend      : ${(b - a - (e - c)).toFixed(1)} ns`,
);
console.log(`borne basse si mémoïsé            : ${(a - f).toFixed(1)} ns\n`);
