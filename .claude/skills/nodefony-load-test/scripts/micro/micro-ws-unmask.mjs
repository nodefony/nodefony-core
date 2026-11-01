#!/usr/bin/env node
/**
 * micro-ws-unmask.mjs — coût du DÉMASQUAGE d'une trame WebSocket entrante, comparé entre
 * deux versions de `ws` (le `lib/buffer-util.js` de chacune, tel que publié).
 *
 * Pourquoi : un client DOIT masquer ses trames (RFC 6455 §5.3), le serveur démasque donc
 * CHAQUE trame reçue — c'est le chemin chaud de l'entrée WebSocket. Depuis ws 8.22.1, le
 * démasquage passe par `http.websocketUnmask()` de Node quand il existe (à partir de 24 o),
 * au lieu de la boucle JS ; `bufferutil` n'étant pas installé ici, c'est la seule
 * accélération possible. Ce banc chiffre l'écart par taille de charge.
 *
 * Usage :
 *   mkdir -p tmp/scratch/ws-diff && cd tmp/scratch/ws-diff && npm pack ws@A ws@B
 *   (extraire chaque tarball dans a/ et b/), puis depuis la racine :
 *   node .claude/skills/nodefony-load-test/scripts/micro/micro-ws-unmask.mjs \
 *     tmp/scratch/ws-diff/a/package tmp/scratch/ws-diff/b/package [--runs 7] [--sizes 24,32,48]
 *
 * Méthode : paires ALTERNÉES A/B par taille (la dérive thermique porte sur les deux),
 * médiane des runs, et « DANS LE BRUIT » quand les séries se chevauchent. Contrôle de
 * validité : les deux versions doivent rendre les MÊMES octets démasqués.
 */
import path from "node:path";
import { createRequire } from "node:module";

const argv = process.argv.slice(2);
const runsAt = argv.indexOf("--runs");
const RUNS = runsAt >= 0 ? Number(argv[runsAt + 1]) : 7;
const sizesAt = argv.indexOf("--sizes");
const dirs = argv.filter(
  (a, i) =>
    !a.startsWith("--") &&
    argv[i - 1] !== "--runs" &&
    argv[i - 1] !== "--sizes",
);
if (dirs.length !== 2) {
  console.error("usage: micro-ws-unmask.mjs <ws-A> <ws-B> [--runs N]");
  process.exit(2);
}
const load = (dir) => {
  const req = createRequire(path.resolve(dir, "package.json"));
  return {
    version: req("./package.json").version,
    util: req("./lib/buffer-util.js"),
  };
};
const [A, B] = dirs.map(load);

const MASK = Buffer.from([0x37, 0xfa, 0x21, 0x3d]);
// `--sizes 24,32,40` pour situer un croisement (le seuil natif de ws est 24 o).
const SIZES =
  sizesAt >= 0
    ? argv[sizesAt + 1].split(",").map(Number)
    : [16, 24, 64, 256, 1024, 16 * 1024, 64 * 1024];

// Validité : mêmes octets démasqués par les deux versions, sur chaque taille.
for (const size of SIZES) {
  const src = Buffer.from(
    Array.from({ length: size }, (_, i) => (i * 31) & 0xff),
  );
  const a = Buffer.from(src);
  const b = Buffer.from(src);
  A.util.unmask(a, MASK);
  B.util.unmask(b, MASK);
  if (!a.equals(b) || a.equals(src)) {
    console.error(`✗ ${size} o : démasquage divergent ou nul — banc invalide`);
    process.exit(1);
  }
}

/** ns par démasquage, sur un lot calibré pour ~20 ms. */
function measure(unmask, buf) {
  const iters = Math.max(200, Math.floor(2e7 / (buf.length + 64)));
  for (let i = 0; i < 1000; i++) unmask(buf, MASK);
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < iters; i++) unmask(buf, MASK);
  return Number(process.hrtime.bigint() - t0) / iters;
}
const median = (xs) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)];

console.log(
  `ws ${A.version} (A) contre ${B.version} (B) — ${RUNS} paires alternées, Node ${process.version}`,
);
console.log("taille     A ns/op    B ns/op    B/A     verdict");
for (const size of SIZES) {
  const buf = Buffer.alloc(size, 0x5a);
  const ra = [];
  const rb = [];
  for (let r = 0; r < RUNS; r++) {
    ra.push(measure(A.util.unmask, buf));
    rb.push(measure(B.util.unmask, buf));
  }
  const ma = median(ra);
  const mb = median(rb);
  const separated =
    Math.max(...rb) < Math.min(...ra) || Math.min(...rb) > Math.max(...ra);
  console.log(
    `${String(size).padStart(6)} o ${ma.toFixed(1).padStart(10)} ${mb.toFixed(1).padStart(10)} ${(mb / ma).toFixed(2).padStart(7)}   ${separated ? (mb < ma ? "B plus rapide" : "B plus lent") : "DANS LE BRUIT"}`,
  );
}
