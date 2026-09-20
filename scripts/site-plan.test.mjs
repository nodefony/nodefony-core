/**
 * Éprouve le lecteur de dépendances du gabarit d'application.
 *
 * Ce qu'il garde n'est pas un détail de forme : le nombre de dépendances d'une
 * application générée est AFFIRMÉ sur les surfaces d'accueil (`AGENTS.md`, le
 * `llms.txt` du site). C'est l'argument qui distingue le produit du dépôt de
 * développement. S'il dérive sans bruit, l'accueil ment.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  APP_TEMPLATE_PATH,
  minimalAppDependencies,
  readMinimalAppDependencies,
} from "./lib/app-template-deps.mjs";

const RACINE = path.resolve(import.meta.dirname, "..");
const gabarit = fs.readFileSync(path.join(RACINE, APP_TEMPLATE_PATH), "utf8");

describe("dépendances d'une application minimale", () => {
  it("rend les quatre paquets du niveau zéro, et rien des variantes", () => {
    expect(minimalAppDependencies(RACINE)).toEqual([
      "nodefony",
      "@nodefony/http",
      "@nodefony/framework",
      "zod",
    ]);
  });

  it("ignore ce qu'un bloc conditionnel apporte", () => {
    // Les dépendances de `--complete` (ORM, sécurité, console) vivent dans un
    // `<% if (it.complete) %>` : les compter ferait dire à l'accueil qu'une
    // application minimale installe une pile entière.
    expect(gabarit).toMatch(/<% if \(it\.complete\) \{ %>/);
    expect(minimalAppDependencies(RACINE)).not.toContain("@nodefony/orm-core");
    expect(minimalAppDependencies(RACINE)).not.toContain("@nodefony/studio");
  });

  it("voit une dépendance AJOUTÉE hors conditionnel", () => {
    // La ligne de `zod` est précédée d'une balise EJS fermante, pas d'un simple
    // retour : la sonde s'insère donc sur la MÊME ligne, juste après elle — ce qui
    // est aussi le cas le plus retors pour le compteur de profondeur.
    const mute = gabarit.replace(
      / {4}"zod":/,
      '    "sonde-de-controle": "1.0.0",\n    "zod":',
    );
    expect(mute).not.toBe(gabarit);
    expect(readMinimalAppDependencies(mute)).toContain("sonde-de-controle");
  });

  it("échoue plutôt que de rendre une liste vide sur un gabarit restructuré", () => {
    expect(() => readMinimalAppDependencies('{ "name": "app" }')).toThrow(
      /dependencies/,
    );
  });

  it("dit la même chose que l'accueil du dépôt", () => {
    // `AGENTS.md` affirme ce chiffre à un agent qui évalue le framework, et
    // `llms.txt` le lui affirme depuis le site. Le site le CALCULE ; `AGENTS.md`
    // est écrit à la main — c'est donc lui qui peut dériver, et ce cas est la
    // seule chose qui l'en empêche.
    const accueil = fs.readFileSync(path.join(RACINE, "AGENTS.md"), "utf8");
    const deps = minimalAppDependencies(RACINE);
    const mots = ["zéro", "une", "deux", "trois", "quatre", "cinq", "six"];
    expect(accueil).toContain(`${mots[deps.length]} dépendances de production`);
    for (const dep of deps) expect(accueil).toContain(`\`${dep}\``);
  });
});
