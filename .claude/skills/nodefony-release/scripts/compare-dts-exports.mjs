#!/usr/bin/env node
/**
 * compare-dts-exports.mjs — compare les exports de TYPES de deux arbres de
 * déclarations (`dist/types` avant/après un refactor), par le compilateur.
 *
 * Pendant de `compare-exports.mjs` (exports à l'exécution) : un refactor qui
 * déplace du code hors d'une classe publique peut garder tous les noms
 * exportés et changer pourtant un membre, une signature, un en-tête. La
 * lecture et le classement des déclarations sont ceux du produit
 * (`scripts/release/api-diff-core.mjs`, qui sert aussi `release:api-diff`) —
 * une seule implémentation.
 *
 * Copier `dist/types` AVANT d'éditer (`cp -R src/nodefony/dist/types tmp/scratch/<sujet>-types-before`),
 * rebâtir, puis comparer. Un membre `private` qui change de nom apparaît en
 * « à relire » : attendu pour un refactor interne, à vérifier un par un.
 *
 * @usage node .claude/skills/nodefony-release/scripts/compare-dts-exports.mjs <avant/> <après/> [fichier.d.ts…]
 * @usage node .claude/skills/nodefony-release/scripts/compare-dts-exports.mjs tmp/scratch/488-types-before src/nodefony/dist/types index.d.ts kernel/Kernel.d.ts types/IKernel.d.ts
 * @option --strict échoue aussi sur un export « à relire » ou de nature changée
 * @output par fichier : exports avant/après, perdus, ajoutés, à relire (membres retirés/modifiés) ; exit 1 si un export est perdu
 */
import path from "node:path";
import process from "node:process";
import {
  classifyDeclaration,
  diffNames,
  readTypeDeclarations,
} from "../../../../scripts/release/api-diff-core.mjs";

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const [beforeDir, afterDir, ...rest] = args.filter((a) => a !== "--strict");
if (!beforeDir || !afterDir) {
  console.error(
    "Usage: compare-dts-exports.mjs <avant/> <après/> [fichier.d.ts…] [--strict]",
  );
  process.exit(2);
}
const files = rest.length ? rest : ["index.d.ts"];

let lost = 0;
let review = 0;
for (const file of files) {
  const before = readTypeDeclarations(path.resolve(beforeDir, file));
  const after = readTypeDeclarations(path.resolve(afterDir, file));
  const { removed, added } = diffNames(Object.keys(before), Object.keys(after));
  const flagged = [];
  for (const name of Object.keys(before)) {
    if (!(name in after)) continue;
    const c = classifyDeclaration(before[name], after[name]);
    if (c.category === "review" || c.category === "kind-changed") {
      flagged.push({ name, ...c });
    }
  }
  console.log(
    `${file}: ${Object.keys(before).length} avant, ${Object.keys(after).length} après · ` +
      `perdus [${removed.join(",")}] · ajoutés [${added.join(",")}] · à relire [${flagged.map((f) => f.name).join(",")}]`,
  );
  for (const f of flagged) {
    const detail =
      f.category === "kind-changed"
        ? "nature changée"
        : [
            f.headerChanged && "en-tête",
            f.removed.length && `retirés ${f.removed.join(",")}`,
            f.changed.length && `modifiés ${f.changed.join(",")}`,
            f.addedRequired.length &&
              `requis ajoutés ${f.addedRequired.join(",")}`,
          ]
            .filter(Boolean)
            .join(" · ") || "texte changé";
    console.log(`   ${f.name} (${f.kind}) : ${detail}`);
  }
  lost += removed.length;
  review += flagged.length;
}
process.exit(lost || (strict && review) ? 1 : 0);
