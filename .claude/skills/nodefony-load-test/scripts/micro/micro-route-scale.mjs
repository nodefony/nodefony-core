// Le scan de routes est-il un problème de PERF (aujourd'hui) ou de SCALABILITÉ
// (quand l'app grandit) ? On mesure le coût du scan à N routes croissant, avec
// la même forme de patterns que Route.compile(), cible placée en FIN de table
// (pire cas réaliste : les modules d'app s'enregistrent après le framework).
//
// Usage : node .claude/skills/nodefony-load-test/scripts/micro/micro-route-scale.mjs
const escapeLit = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const compile = (path) =>
  new RegExp(
    `^${path
      .split(/(\{[^}]+\})/)
      .map((s) => (s.startsWith("{") ? "([^/]+)" : escapeLit(s)))
      .join("")}$`,
    "i",
  );

const TARGET = "/app/orders/history/detail";
const N = 50_000;

// Génère une table réaliste : 1/3 de routes dynamiques, préfixes variés
function makeTable(count) {
  const mods = ["nodefony", "app", "api", "admin", "shop", "user"];
  const out = [];
  for (let i = 0; i < count; i++) {
    const m = mods[i % mods.length];
    out.push(
      i % 3 === 0
        ? `/${m}/res${i}/{id}/edit`
        : `/${m}/section${i % 20}/page${i}`,
    );
  }
  out.push(TARGET);
  return out;
}

// Filtre de préfixe (2 premiers segments) — le geste proposé
const NON_LIT = /[{}*+?()[\]^$|\\]/;
const prefixOf = (p) => {
  const cut = p.search(NON_LIT);
  return (cut === -1 ? p : p.slice(0, cut))
    .split("/")
    .slice(0, 3)
    .join("/")
    .toLowerCase();
};

function bench(list) {
  const res = [];
  for (let i = 0; i < 5_000; i++)
    for (const re of list) if (re.test(TARGET)) break;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) {
    for (const re of list) {
      const m = re.exec(TARGET);
      if (m) {
        res.push(m.length);
        break;
      }
    }
  }
  return Number(process.hrtime.bigint() - t0) / N;
}

console.log(
  `\n=== Sensibilité du scan au nombre de routes (Node ${process.version}) ===\n`,
);
console.log(
  "routes   dyn scannées  scan complet  scan indexé  candidates  part d'un budget 86 µs/req",
);
console.log("─".repeat(78));

const tp = prefixOf(TARGET);
for (const count of [136, 300, 600, 1200, 2400]) {
  const paths = makeTable(count);
  // Partition RÉELLE du routeur : les littérales sont déjà indexées par path
  // exact (Map O(1)) — seules les DYNAMIQUES sont scannées, plus la cible.
  const scannable = paths.filter((p) => NON_LIT.test(p) || p === TARGET);
  const full = scannable.map(compile);
  const kept = scannable.filter((p) => prefixOf(p) === tp);
  const idx = kept.map(compile);
  const a = bench(full);
  const b = bench(idx);
  console.log(
    `${String(count).padStart(5)}  ${String(scannable.length).padStart(11)}  ${(a / 1000).toFixed(2).padStart(9)} µs  ${(b / 1000).toFixed(2).padStart(11)} µs  ${String(kept.length).padStart(10)}   ${((a / 86_000) * 100).toFixed(1).padStart(5)} %`,
  );
}
console.log();
