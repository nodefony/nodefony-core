#!/usr/bin/env node
/**
 * Gate — aucun nom de canal/méthode de plateforme écrit EN DUR dans le code.
 *
 * Le namespace `nodefony:` est un contrat partagé par le serveur et le navigateur.
 * Une chaîne recopiée dans un écran est une chaîne qui survivra au renommage
 * suivant : le producteur bascule, le consommateur reste, la page devient muette
 * — sans qu'aucun test ne rougisse (les écrans n'en ont pas). La table
 * `PLATFORM_CHANNELS` / `PLATFORM_METHODS` (cœur isomorphe) est donc la SEULE
 * source, et ce gate refuse les littéraux qui la contournent.
 *
 * Trois exceptions, toutes délibérées :
 *  - les **tests** gardent les littéraux : ce sont eux qui figent le contrat
 *    public. Un test qui lirait la table suivrait n'importe quel renommage.
 *  - les **commentaires et la prose** (TSDoc, libellés d'interface) : on y nomme
 *    les canaux pour les expliquer, pas pour s'y abonner.
 *  - la **table elle-même**, évidemment.
 *
 * Usage : `node scripts/check-platform-channels.mjs` (exit 1 si un littéral fuit).
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const TABLE = "src/nodefony/src/realtime/platformChannels.ts";

/** Noms exacts servis par la table (lus À LA SOURCE — pas recopiés ici). */
function tableNames() {
  const src = readFileSync(TABLE, "utf8");
  const names = [];
  for (const m of src.matchAll(/^\s+\w+: "(nodefony:[^"]+)",/gm))
    names.push(m[1]);
  if (names.length === 0) {
    console.error(`✗ table illisible : ${TABLE}`);
    process.exit(2);
  }
  return names;
}

const NAMES = tableNames();

const files = execSync(
  "find src -type f \\( -name '*.ts' -o -name '*.tsx' \\) " +
    "-not -path '*/dist/*' -not -path '*/node_modules/*'",
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
)
  .split("\n")
  .filter(Boolean)
  .filter((f) => !f.endsWith("platformChannels.ts"))
  .filter((f) => !/\/tests?\//.test(f) && !/\.test\.tsx?$/.test(f));

/** Ligne de commentaire → prose, hors périmètre. */
const isComment = (line) => /^\s*(\/\/|\*|\/\*)/.test(line);

const offenses = [];
for (const file of files) {
  const src = readFileSync(file, "utf8");
  if (!src.includes("nodefony:")) continue;
  src.split("\n").forEach((line, i) => {
    if (isComment(line)) return;
    for (const name of NAMES) {
      // Ce qui est du CODE :
      //  - `"nodefony:x"` / `'nodefony:x'` (guillemets = valeur passée à un appel) ;
      //  - un template dont le nom est la BASE d'un suffixe : `` `nodefony:x@${id}` ``
      //    ou une cadence `` `nodefony:x:${ms}` ``.
      // Ce qui est de la PROSE (toléré) : `` `nodefony:x` `` seul dans une phrase —
      // c'est du markdown inline dans un libellé ou un TSDoc, pas un abonnement.
      const quoted = new RegExp(`["']${name}["']`);
      const templated = new RegExp("`" + name + "(@|:)\\$\\{");
      if (quoted.test(line) || templated.test(line)) {
        offenses.push({ file, line: i + 1, name, text: line.trim() });
        break;
      }
    }
  });
}

if (offenses.length === 0) {
  console.log(
    `✓ ${NAMES.length} noms de plateforme, 0 littéral en dur (${files.length} fichiers).`,
  );
  process.exit(0);
}

console.error(
  `✗ ${offenses.length} nom(s) de plateforme écrit(s) en dur — utiliser ` +
    `PLATFORM_CHANNELS / PLATFORM_METHODS (importés de "nodefony") :\n`,
);
for (const o of offenses) {
  console.error(`  ${o.file}:${o.line}  ${o.name}`);
  console.error(`      ${o.text.slice(0, 100)}`);
}
process.exit(1);
