// ─────────────────────────────────────────────────────────────────────────────
// Micro-banc — ce que coûte VRAIMENT le traitement de l'en-tête `Host` d'une
// requête (dist de @nodefony/http) : découpe du port, contrôle de forme
// canonique, test des domaines de confiance.
//
// Pourquoi il existe : le profil V8 prêtait ~8,5 µs/req à ces trois fonctions ;
// ce banc en a mesuré ~0,5 (#508). Tout poste désigné par un profil se convertit
// ici en ns AVANT d'ouvrir un chantier. Il ment dans l'autre sens (tas froid,
// site d'appel monomorphe) : l'arbitre reste la mesure in-situ (wait-compare.sh).
//
// Usage (depuis la racine, dist de @nodefony/http bâti) :
//   node .claude/skills/nodefony-load-test/scripts/micro/micro-host.mjs [host=127.0.0.1:5151]
// ─────────────────────────────────────────────────────────────────────────────
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../..",
);
const dist = path.join(
  root,
  "src/packages/@nodefony/http/dist/nodefony/src/context",
);
const { isCanonicalAuthority } = await import(
  pathToFileURL(path.join(dist, "http", "urlFastPath.js")).href
);
const { compileTrustedHosts, isDomainAllowed } = await import(
  pathToFileURL(path.join(dist, "domainMatcher.js")).href
);

const sample = process.argv[2] ?? "127.0.0.1:5151";
const domain = sample.split(":")[0];
const regs = compileTrustedHosts(domain, false, false);
// Chaînes DISTINCTES, comme celles qu'un parseur rend à chaque requête : une
// seule chaîne réutilisée profiterait de caches que la production n'a pas.
const raw = Buffer.from(sample, "latin1");
const hosts = Array.from({ length: 1024 }, () => raw.toString("latin1"));
const N = 5e6;
let sink = 0;

function bench(name, fn) {
  for (let i = 0; i < 2e5; i++) sink ^= fn(hosts[i & 1023]) ? 1 : 0;
  const t = process.hrtime.bigint();
  for (let i = 0; i < N; i++) sink ^= fn(hosts[i & 1023]) ? 1 : 0;
  return Number(process.hrtime.bigint() - t) / N;
}

const cases = {
  "split(':')[0]": (h) => h.split(":")[0].length,
  "indexOf + slice": (h) => {
    const i = h.indexOf(":");
    return (i === -1 ? h : h.slice(0, i)).length;
  },
  isCanonicalAuthority: (h) => isCanonicalAuthority(h, "http"),
  isDomainAllowed: (h) => isDomainAllowed(regs, h.split(":")[0]),
};
const runs = Object.fromEntries(Object.keys(cases).map((k) => [k, []]));
for (let r = 0; r < 5; r++)
  for (const [k, fn] of Object.entries(cases)) runs[k].push(bench(k, fn));
console.log(`Host « ${sample} » — médiane de 5 runs de ${N} appels`);
for (const [k, xs] of Object.entries(runs)) {
  const s = [...xs].sort((a, b) => a - b);
  console.log(
    `${s[2].toFixed(1).padStart(7)} ns  ${k}   (min ${s[0].toFixed(1)}, max ${s[4].toFixed(1)})`,
  );
}
if (sink === 42) console.log("");
