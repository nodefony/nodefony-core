// Compare DEUX profils pris par `profile-cpu.sh` dans le même décor, poste à
// poste, en µs par requête. C'est la question qu'un profil isolé ne pose
// jamais : « combien de trop, et OÙ, par rapport à ce qui est possible ? ».
//
// Trois tableaux :
//   1. le total CPU/req et l'écart ;
//   2. le travail de NODE et du moteur (modules `node:*`, natifs, GC,
//      micro-tâches) — mêmes fonctions des deux côtés, donc comparables
//      fonction à fonction : c'est là qu'on voit ce que le framework FAIT FAIRE
//      à Node (écouteurs, Promises, écritures) ;
//   3. le code propre de chaque framework, par origine puis ses fonctions les
//      plus chères — non comparables nom à nom, lus côte à côte.
//
// Usage : node profile-compare.mjs <dossier A> <dossier B> [top=25]

import path from "node:path";
import { analyzeProfile, isFrameworkOrigin } from "./profile-analyze.mjs";

const [dirA, dirB, top = "25"] = process.argv.slice(2);
if (!dirA || !dirB) {
  console.error("usage : profile-compare.mjs <dossier A> <dossier B> [top]");
  process.exit(2);
}
const A = analyzeProfile(dirA);
const B = analyzeProfile(dirB);
const nameA = path.basename(dirA);
const nameB = path.basename(dirB);
const us = (v, r) => v / r.req;
const cell = (n) => n.toFixed(2).padStart(8);

// L'origine de chaque fonction est mémorisée à l'agrégation : un nom de
// trame peut contenir des espaces (`RegExp: …`), il ne se re-découpe pas.
const originOfKey = (k) => A.keyOrigin.get(k) ?? B.keyOrigin.get(k) ?? "(?)";

console.log(`== total CPU par requête ==`);
const tA = us(A.total, A);
const tB = us(B.total, B);
console.log(
  `${nameA} ${tA.toFixed(1)} µs · ${nameB} ${tB.toFixed(1)} µs · écart ${(tA - tB).toFixed(1)} µs (${((100 * tA) / tB).toFixed(0)} %)`,
);
console.log(`(requêtes de la fenêtre : ${nameA} ${A.req}, ${nameB} ${B.req})`);

console.log(
  `\n== Node et moteur, fonction à fonction (µs/req) — trié par écart ==`,
);
console.log(`${nameA.padStart(8)} ${nameB.padStart(8)}    écart  fonction`);
const keys = new Set();
for (const m of [A.self, B.self]) {
  for (const k of m.keys()) if (!isFrameworkOrigin(originOfKey(k))) keys.add(k);
}
const rows = [...keys]
  .map((k) => {
    const a = us(A.self.get(k) ?? 0, A);
    const b = us(B.self.get(k) ?? 0, B);
    return { k, a, b, d: a - b };
  })
  .sort((x, y) => Math.abs(y.d) - Math.abs(x.d))
  .slice(0, Number(top));
for (const r of rows) {
  console.log(`${cell(r.a)} ${cell(r.b)} ${cell(r.d)}  ${r.k}`);
}

function frameworkSide(R, label) {
  let sum = 0;
  const origins = [...R.origin].filter(([o]) => isFrameworkOrigin(o));
  for (const [, v] of origins) sum += v;
  console.log(
    `\n== code propre — ${label} : ${us(sum, R).toFixed(1)} µs/req ==`,
  );
  for (const [o, v] of origins.sort((x, y) => y[1] - x[1]).slice(0, 10)) {
    console.log(`${cell(us(v, R))}  ${o}`);
  }
  console.log("  — fonctions les plus chères :");
  const fns = [...R.self]
    .filter(([k]) => isFrameworkOrigin(originOfKey(k)))
    .sort((x, y) => y[1] - x[1])
    .slice(0, Number(top));
  for (const [k, v] of fns) console.log(`${cell(us(v, R))}  ${k}`);
}
frameworkSide(A, nameA);
frameworkSide(B, nameB);
