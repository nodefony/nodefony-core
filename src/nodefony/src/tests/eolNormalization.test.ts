/*
 *   Les artefacts comparés OCTET POUR OCTET sont normalisés en LF.
 *
 *   Le défaut gravé ici a coûté trois jobs Windows rouges pendant deux jours,
 *   sur un message qui envoyait au mauvais endroit : « man/nodefony.1 est
 *   PÉRIMÉE — node scripts/generate-man.mjs ». La page n'était pas périmée. Git
 *   la convertissait en CRLF au checkout Windows (`core.autocrlf` vaut `true`
 *   sur les runners GitHub), le générateur produit du LF, et la comparaison
 *   octet pour octet échouait. Régénérer n'y aurait rien changé.
 *
 *   Ce test ne lit pas les fichiers : il interroge GIT sur ce qu'il fera au
 *   checkout. C'est le seul moyen d'éprouver une règle de plateforme sans la
 *   plateforme — le verdict est demandé à l'outil qui l'applique, au lieu d'être
 *   déduit de `process.platform`.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const RACINE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

/**
 * Ce que git fera de ce chemin au checkout, selon `.gitattributes`.
 *
 * @param rel - chemin relatif à la racine du dépôt.
 * @returns la valeur de l'attribut `eol` (`"lf"`, `"crlf"`, `"unspecified"`…).
 */
function attributEol(rel: string): string {
  const sortie = execFileSync("git", ["check-attr", "eol", "--", rel], {
    cwd: RACINE,
    encoding: "utf8",
  });
  // Forme : « <chemin>: eol: lf »
  return sortie.trim().split(": ").pop() ?? "";
}

// Artefacts qu'un gate compare octet pour octet à la sortie d'un générateur.
// Pour eux, le LF n'est pas une convention de style : c'est une CONDITION de
// correction du gate.
const COMPARES_OCTET_POUR_OCTET = ["man/nodefony.1", ".ai/symbols.json"];

describe("fins de ligne — les artefacts générés restent en LF", () => {
  const dansUnDepot = existsSync(path.join(RACINE, ".git"));

  // ⏱️ Ce test SPAWNE `git` : le défaut de 5 s de vitest est un budget
  // d'assertion, pas de démarrage de process. Sous `turbo run test` (tous les
  // workspaces en parallèle) il est dépassé sans qu'aucun défaut n'existe —
  // vert en isolation, rouge dans `npm run verify`. Rien ne s'évalue en temps
  // ici : le délai n'est pas une mesure.
  it(".gitattributes existe", { skip: !dansUnDepot, timeout: 60_000 }, () => {
    expect(existsSync(path.join(RACINE, ".gitattributes"))).toBe(true);
  });

  for (const rel of COMPARES_OCTET_POUR_OCTET) {
    it(
      `${rel} est déclaré eol=lf`,
      { skip: !dansUnDepot, timeout: 60_000 },
      () => {
        expect(
          attributEol(rel),
          `${rel} est comparé octet pour octet à un générateur qui écrit du ` +
            `LF. Sans « eol=lf » dans .gitattributes, git le convertit en CRLF ` +
            `au checkout Windows et le gate accuse un fichier à jour.`,
        ).toBe("lf");
      },
    );
  }
});
