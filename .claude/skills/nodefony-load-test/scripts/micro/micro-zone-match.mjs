// ─────────────────────────────────────────────────────────────────────────────
// Micro-banc — la correspondance des zones du pare-feu (`Firewall.isSecure`),
// Nodefony contre le témoin `nest-fair`, sur la route de banc (qui ne tombe dans
// AUCUNE zone, donc les parcourt toutes).
//
// Le travail est le même des deux côtés : 7 `RegExp.test` d'ancrage sur un
// chemin déjà extrait. UNE différence de construction : Nodefony compile ses
// motifs avec le drapeau `u` (`SecuredArea.ts`, `new RegExp(pattern, "u")`),
// le témoin sans (`fair-common.mjs`). Ce banc chiffre ce que coûte ce drapeau,
// et ce que coûte la forme de boucle (objet zone + contrôle d'hôte).
//
// Usage : node micro-zone-match.mjs [runs=7]
// Lit une médiane de N runs ; mesuré in situ (`span-run.sh`) : ~0,5 µs/req.
// ─────────────────────────────────────────────────────────────────────────────
import { performance } from "node:perf_hooks";

// Ordre et motifs de `fair-common.mjs` — les zones RÉELLES de l'app de banc.
const SOURCES = [
  "^/nodefony/test/foreign-audience",
  "^/nodefony/kernel/api/livez$",
  "^/nodefony/test/self-external",
  "^/nodefony/[^/]+/api(/|$)",
  "^/nodefony/test/external",
  "^/nodefony/test/secure",
  "^/nodefony/test/m2m",
];
const PATH = "/nodefony/test/als-test/state";
const RUNS = Number(process.argv[2] ?? 7);
const N = 2_000_000;

/** Forme Nodefony : objet zone, contrôle d'hôte, puis `pattern.test`. */
const areasOf = (flags) =>
  SOURCES.map((s) => ({
    host: undefined,
    pattern: new RegExp(s, flags),
    matchPath(pathname, host) {
      if (this.host && this.host !== host) return false;
      return this.pattern.test(pathname);
    },
  }));
const nodefony = (areas) => (p, host) => {
  for (const area of areas) if (area.matchPath(p, host)) return area;
  return null;
};
/** Forme du témoin : tableau de `{ re }`, `re.test` direct. */
const witness = (flags) => {
  const list = SOURCES.map((s) => ({ re: new RegExp(s, flags) }));
  return (p) => {
    for (const a of list) if (a.re.test(p)) return a;
    return null;
  };
};

const variants = {
  "nodefony (u)": nodefony(areasOf("u")),
  "nodefony (sans u)": nodefony(areasOf("")),
  "témoin (sans u)": witness(""),
  "témoin (u)": witness("u"),
};

// Garde de validité : la route de banc ne tombe dans aucune zone, et un chemin
// d'API dans la bonne — sinon on chronométrerait autre chose.
for (const [name, fn] of Object.entries(variants)) {
  if (fn(PATH, "127.0.0.1") !== null || fn("/nodefony/kernel/api/x") === null) {
    console.error(`❌ ${name} : correspondance fausse — banc invalide`);
    process.exit(1);
  }
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
};
const results = Object.fromEntries(Object.keys(variants).map((k) => [k, []]));
let sink = 0;
// Runs ALTERNÉS entre variantes : la dérive de la machine porte sur toutes.
for (let r = 0; r < RUNS; r++) {
  for (const [name, fn] of Object.entries(variants)) {
    const t0 = performance.now();
    for (let i = 0; i < N; i++) if (fn(PATH, "127.0.0.1") === null) sink++;
    results[name].push(((performance.now() - t0) * 1e6) / N);
  }
}
if (sink !== RUNS * N * Object.keys(variants).length) process.exit(1);

console.log(`\n${PATH} — 7 zones, médiane de ${RUNS} runs (ns/appel)\n`);
for (const [name, xs] of Object.entries(results)) {
  const spread = (Math.max(...xs) - Math.min(...xs)) / median(xs);
  console.log(
    `${name.padEnd(20)} ${median(xs).toFixed(1).padStart(7)}   [${Math.min(...xs).toFixed(1)} ; ${Math.max(...xs).toFixed(1)}]  disp. ${(spread * 100).toFixed(1)} %`,
  );
}
console.log(
  "\n⚠️ Micro-banc : sites monomorphes, tas froid — l'arbitre reste la sonde in situ.",
);
