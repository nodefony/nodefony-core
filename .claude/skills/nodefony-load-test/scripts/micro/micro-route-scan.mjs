// Micro-bench isolé — coût du SCAN de routes par requête.
// Patterns construits depuis les VRAIES routes de l'app (tmp/routes-inspect.json),
// même forme que Route.compile() : ancrés ^…$, flag `i`, {var} → ([^/]+).
//
// Mesure 3 choses :
//   1. le coût unitaire d'un match qui ÉCHOUE (le cas des 42 routes sur 43) ;
//   2. String.match vs RegExp.exec vs RegExp.test (le geste local) ;
//   3. ce que rendrait un scan RÉDUIT par index de préfixe (le geste structurel).
//
// Usage : node .claude/skills/nodefony-load-test/scripts/micro/micro-route-scan.mjs
import { readFileSync } from "node:fs";

// La table de routes est un ARTEFACT régénérable, jamais une dépendance figée :
// `tmp/` se vide au premier ménage. Chemin surchargeable, et si le fichier manque
// on dit COMMENT le refaire plutôt que d'échouer sur un ENOENT nu.
const ROUTES_JSON = process.env.NF_ROUTES_JSON ?? "tmp/routes-inspect.json";
let routes;
try {
  routes = JSON.parse(readFileSync(ROUTES_JSON, "utf8"));
} catch {
  console.error(
    `Table de routes introuvable : ${ROUTES_JSON}\n` +
      "Régénérer depuis l'app courante :\n" +
      `  npx nodefony inspect routes --json > ${ROUTES_JSON}\n` +
      "ou pointer ailleurs : NF_ROUTES_JSON=<chemin> node ...",
  );
  process.exit(1);
}
const NON_LIT = /[{}*+?()[\]^$|\\]/;
const escapeLit = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function compile(path) {
  if (path === null || path === undefined) return null;
  const pattern = path
    .split(/(\{[^}]+\})/)
    .map((seg) =>
      seg.startsWith("{") && seg.endsWith("}") ? "([^/]+)" : escapeLit(seg),
    )
    .join("");
  return new RegExp(`^${pattern}$`, "i");
}

// La cible du profil : /nodefony/security/api/auth/me, 43ᵉ candidate du scan
const TARGET = "/nodefony/security/api/auth/me";
const isDyn = (r) => r.path == null || NON_LIT.test(r.path);

// Séquence RÉELLE des candidates (merge littérales-du-path ∪ dynamiques par position)
const seq = [];
for (const r of routes) {
  if (isDyn(r) || r.path === TARGET) seq.push(compile(r.path));
  if (r.path === TARGET) break;
}
const scanned = seq.filter(Boolean);
console.log(`\n=== Scan de routes — cible ${TARGET} ===`);
console.log(
  `Node ${process.version} — candidates scannées : ${scanned.length}\n`,
);

const N = 100_000;
function bench(label, fn) {
  for (let i = 0; i < 10_000; i++) fn();
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) fn();
  const ns = Number(process.hrtime.bigint() - t0) / N;
  console.log(
    `${label.padEnd(48)} ${ns.toFixed(0).padStart(7)} ns/req  (${(ns / scanned.length).toFixed(0)} ns/route)`,
  );
  return ns;
}

const a = bench("scan complet — url.match(re)   [ACTUEL]", () => {
  for (const re of scanned) {
    const res = TARGET.match(re);
    if (res) return res;
  }
});

const b = bench("scan complet — re.exec(url)", () => {
  for (const re of scanned) {
    const res = re.exec(TARGET);
    if (res) return res;
  }
});

const c = bench("scan complet — re.test puis exec sur le hit", () => {
  for (const re of scanned) {
    if (re.test(TARGET)) return re.exec(TARGET);
  }
});

// Geste structurel : index par préfixe statique (2 premiers segments du path).
// Seules les dynamiques dont le préfixe est compatible restent candidates.
const prefixOf = (p) => {
  const cut = p.search(NON_LIT);
  const head = cut === -1 ? p : p.slice(0, cut);
  return head.split("/").slice(0, 3).join("/").toLowerCase(); // "" + 2 segments
};
const targetPrefix = prefixOf(TARGET);
const reduced = [];
for (const r of routes) {
  if (r.path == null) continue;
  const compatible = prefixOf(r.path) === targetPrefix;
  if ((isDyn(r) && compatible) || r.path === TARGET)
    reduced.push(compile(r.path));
  if (r.path === TARGET) break;
}
console.log(
  `\ncandidates après index de préfixe : ${reduced.length} (au lieu de ${scanned.length})`,
);

const d = bench("scan RÉDUIT — re.exec(url)     [PROPOSÉ]", () => {
  for (const re of reduced) {
    const res = re.exec(TARGET);
    if (res) return res;
  }
});

console.log(`\n--- Verdict (par requête, route auth/me) ---`);
console.log(
  `geste local  (match → exec)      : ${(a - b).toFixed(0)} ns  (${(((a - b) / a) * 100).toFixed(0)} %)`,
);
console.log(
  `geste structurel (index préfixe) : ${(a - d).toFixed(0)} ns  (${(((a - d) / a) * 100).toFixed(0)} %)`,
);
console.log(`coût résiduel du scan réduit     : ${d.toFixed(0)} ns\n`);
