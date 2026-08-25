/*
 *   Une application générée naît avec les fichiers de RÈGLE, pas seulement de code.
 *
 *   Deux manquaient, et chacun rend un défaut invisible :
 *
 *   - `.prettierignore` : le gabarit fournit `npm run format` (`prettier
 *     --write .`). Prettier écarte `node_modules` de lui-même, mais PAS `dist/`.
 *     Sans ce fichier, un seul `npm run format` reformate le BUILD.
 *   - `.gitattributes` : sans lui, git convertit en CRLF au checkout Windows.
 *     Tout ce qui compare un fichier à une sortie de générateur échoue alors sur
 *     `\r\n` contre `\n` — et le message d'erreur parle d'autre chose. Le dépôt
 *     du framework a vécu exactement cela : trois jobs Windows rouges pendant
 *     deux jours sur « page PÉRIMÉE », alors que rien n'était périmé.
 *
 *   Ce test porte sur les GABARITS et sur la table de renommage. npm retire le
 *   point des dotfiles publiés : un gabarit nommé `.prettierignore` n'arriverait
 *   JAMAIS chez l'installeur, d'où `prettierignore.tpl` + une entrée dans
 *   `RENAMES`. Oublier la seconde livre un fichier sans son point — inerte, et
 *   silencieusement.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const CORE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const BASE = path.join(CORE, "templates/app/base");

/** Gabarit → nom rendu, pour les fichiers de règle qu'une app doit recevoir. */
const ATTENDUS: ReadonlyArray<[string, string]> = [
  ["gitignore.tpl", ".gitignore"],
  ["prettierrc.json.tpl", ".prettierrc.json"],
  ["prettierignore.tpl", ".prettierignore"],
  ["gitattributes.tpl", ".gitattributes"],
  ["oxlintrc.json.tpl", ".oxlintrc.json"],
  ["dockerignore.tpl", ".dockerignore"],
];

describe("application générée — les fichiers de RÈGLE", () => {
  // Les VALEURS réellement déclarées, pas une recherche de sous-chaîne : le nom
  // rendu pourrait apparaître ailleurs dans le fichier (un commentaire suffit)
  // et rendrait ce contrôle complaisant.
  const engine = readFileSync(
    path.join(CORE, "src/cli/scaffold/engine.ts"),
    "utf8",
  );
  const bloc = engine.slice(engine.indexOf("const RENAMES"));
  const declares = new Set(
    [...bloc.slice(0, bloc.indexOf("};")).matchAll(/:\s*"([^"]+)"/gu)].map(
      (m) => m[1] as string,
    ),
  );

  for (const [tpl, rendu] of ATTENDUS) {
    it(`${rendu} : le gabarit existe`, () => {
      expect(
        existsSync(path.join(BASE, tpl)),
        `${tpl} manque dans templates/app/base — l'application naîtra sans ${rendu}`,
      ).toBe(true);
    });

    it(`${rendu} : le renommage est déclaré`, () => {
      // Sans l'entrée, le fichier sort SANS son point : présent, mais inerte,
      // et rien ne le signale.
      expect(
        declares.has(rendu),
        `« ${rendu} » n'est pas dans RENAMES (scaffold/engine.ts) : le fichier ` +
          `serait livré sans son point initial, donc ignoré par l'outil qu'il ` +
          `est censé configurer.`,
      ).toBe(true);
    });
  }

  it("le .prettierignore généré protège au moins dist/ et var/", () => {
    const contenu = readFileSync(path.join(BASE, "prettierignore.tpl"), "utf8");
    for (const motif of ["dist/", "var/"]) {
      expect(
        contenu.includes(motif),
        `le .prettierignore généré doit écarter « ${motif} » — sinon ` +
          `« npm run format » reformate des artefacts de build.`,
      ).toBe(true);
    }
  });

  it("le .gitattributes généré normalise les fins de ligne en LF", () => {
    const contenu = readFileSync(path.join(BASE, "gitattributes.tpl"), "utf8");
    expect(contenu).toMatch(/^\*\s+text=auto\s+eol=lf$/mu);
  });
});
