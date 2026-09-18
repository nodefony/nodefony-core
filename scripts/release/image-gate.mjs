#!/usr/bin/env node
/**
 * **Refuse de publier une image de conteneur qui embarque un secret.**
 *
 * 🔴 **Ce script ne porte plus le contrôle : il l'APPELLE.** La règle, la
 * lecture des couches et les verdicts vivent désormais dans le produit
 * (`nodefony/src/cli/image/`, commande `nodefony image:check`), pour une raison
 * qui n'est pas de l'esthétique : `scripts/` n'est **pas publié**. Tant que le
 * contrôle vivait ici, une application créée avec Nodefony n'avait AUCUN moyen
 * de regarder sa propre image — alors que c'est elle qui la pousse. Une copie
 * conservée ici aurait divergé au premier réglage, et chacune serait restée
 * verte sur ses propres tests.
 *
 * Ce qui reste ici est la porte du DÉPÔT : `npm run release:image-gate`, lancé
 * sur l'image officielle avant publication. Les symboles ré-exportés plus bas
 * servent au banc (`image-gate.test.mjs`), qui éprouve donc le CODE DU PRODUIT.
 *
 * ## Usage
 *
 * ```bash
 * node scripts/release/image-gate.mjs nodefony/nodefony:10.0.0-alpha.7
 * node scripts/release/image-gate.mjs --files inventaire.txt   # sans docker
 * ```
 *
 * Sortie 0 = rien de suspect. Sortie 1 = refus, chaque fichier nommé.
 * Sortie 69 = le contrôle n'a pas pu regarder (à traiter comme un refus).
 */
import { pathToFileURL } from "node:url";

// 🔴 L'import est DYNAMIQUE, et le catch n'est PAS une commodité : un import
// statique qui échoue rend « Cannot find module … /dist/node/cli/image/index.js »
// — un message qui ne dit pas ce qu'il faut faire, au seul moment où l'on
// publie. Ici l'absence du `dist` devient un CONTRÔLE AVEUGLE nommé, avec son
// remède. Ce qu'il ne fait JAMAIS, c'est replier sur un verdict favorable :
// l'appelant reçoit un code non nul, donc un refus.
//
// ⚠️ Ce script-ci peut dépendre du `dist` ; la chaîne de PUBLICATION, non.
// `release-core.mjs` garde donc sa propre copie de la règle des noms, gardée
// alignée par un test de parité (`imageCheck.test.ts`, core) — faire dépendre
// le cœur de la publication d'une construction, c'est risquer `release:pack`,
// `release:smoke` et le préflight pour une économie de vingt lignes.
let runImageCheckCommand;
let imageContents;
let readTarHeader;
let tarPathsFromStream;
try {
  ({ runImageCheckCommand } =
    await import("../../src/nodefony/dist/node/cli/image/index.js"));
  // Les briques se prennent à leur MODULE, pas au barrel : le bundler élague
  // les ré-exports que la surface publique du paquet ne consomme pas, si bien
  // que `index.js` n'expose que la commande. Un import par le barrel
  // compilerait et rendrait `undefined` — donc un banc qui tombe sans dire
  // pourquoi.
  ({ imageContents, readTarHeader, tarPathsFromStream } =
    await import("../../src/nodefony/dist/node/cli/image/tarLayers.js"));
} catch (erreur) {
  process.stderr.write(
    `\n✗ CONTRÔLE AVEUGLE — le contrôle d'image vit dans le produit, et sa\n` +
      `  construction est absente : ${erreur.message}\n\n` +
      `  → npm run build   (puis relancer)\n\n`,
  );
  process.exit(69);
}

// Axiome de portabilité : on compare des URL, jamais des chemins — sous Windows
// `D:\…` se lit comme un protocole, et la comparaison serait faussée sans erreur.
const lanceDirectement =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (lanceDirectement) {
  // Le mot `image:check` est ce que l'analyseur du produit cherche dans l'argv :
  // sans lui, il ne verrait aucun argument et se plaindrait d'un usage vide.
  process.exitCode = await runImageCheckCommand([
    process.argv[0],
    process.argv[1],
    "image:check",
    ...process.argv.slice(2),
  ]);
}

// Noms historiques du banc — ils désignent maintenant les fonctions du produit.
export {
  imageContents as cheminsDeLImage,
  tarPathsFromStream as cheminsDuFlux,
  readTarHeader as lireEntete,
};
