/*
 *   Le menu ne propose que des scripts qui EXISTENT quelque part.
 *
 *   Le menu filtre déjà sur le `package.json` du projet courant : une entrée
 *   absente n'apparaît jamais. C'est ce qui rend l'ajout d'entrées sans danger
 *   — et c'est aussi ce qui rend une entrée MORTE invisible. Un script mal
 *   orthographié, ou retiré d'un gabarit, disparaîtrait du menu sans que rien
 *   ne le signale : on croirait le geste offert alors qu'il n'est nulle part.
 *
 *   Ce test ferme ce trou par le seul bout qui tienne : chaque entrée doit être
 *   fournie par au moins un des deux contextes RÉELS — l'application que le
 *   scaffold génère, ou le dépôt du framework lui-même.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { NPM_SCRIPT_CATALOG, buildStartMenu } from "../cli/startMenu";

const CORE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const RACINE = path.resolve(CORE, "../..");

/**
 * Les clés de `scripts` du gabarit d'application.
 *
 * Le fichier est un TEMPLATE (`<% if … %>`), donc illisible par `JSON.parse` :
 * on lit les clés du bloc `scripts` telles qu'elles y sont écrites. Le motif
 * accepte les deux-points et les majuscules — les rater ferait passer une
 * entrée pour absente et rendrait ce test faussement rouge.
 */
function scriptsDuGabarit(): Set<string> {
  const tpl = readFileSync(
    path.join(CORE, "templates/app/base/package.json.tpl"),
    "utf8",
  );
  const bloc = tpl.slice(tpl.indexOf('"scripts"'));
  const zone = bloc.slice(0, bloc.indexOf('"dependencies"'));
  return new Set(
    [...zone.matchAll(/"([a-zA-Z][\w:-]*)"\s*:/gu)].map((m) => m[1] as string),
  );
}

/** Les clés de `scripts` du `package.json` du dépôt. */
function scriptsDuDepot(): Set<string> {
  const pkg = JSON.parse(
    readFileSync(path.join(RACINE, "package.json"), "utf8"),
  ) as { scripts?: Record<string, string> };
  return new Set(Object.keys(pkg.scripts ?? {}));
}

/**
 * Ce que ce contrôle garde : le menu d'une APPLICATION GÉNÉRÉE n'affiche que
 * ce qu'elle possède.
 *
 * Le catalogue porte aussi des gestes propres au dépôt du framework
 * (`check:lang`, `ticket:lint`, `doc:anchors`). Une application ne les a pas —
 * et un séparateur suivi de rien, ou pire une entrée qui lance un script
 * absent, transforme le menu en promesse fausse. C'est le filtre par PRÉSENCE
 * qui l'évite ; ce test le tient.
 */
describe("menu d'une application générée — ni entrée ni section fantôme", () => {
  const gabarit = scriptsDuGabarit();

  it("ne propose aucun script que l'app n'a pas, et aucune section vide", () => {
    const menu = buildStartMenu({
      inProject: true,
      describe: () => null,
      npmScripts: [...gabarit],
      projectName: "mon-app",
    });
    const proposes = menu.items
      .filter((i) => i.kind === "choice" && i.value.startsWith("npm:"))
      .map((i) => (i.kind === "choice" ? i.value.slice("npm:".length) : ""));
    expect(proposes.length).toBeGreaterThan(3);
    for (const script of proposes) {
      expect(
        gabarit.has(script),
        `le menu d'une app propose « ${script} », absent de son package.json`,
      ).toBe(true);
    }
    // Les gestes du DÉPÔT ne fuient pas chez l'utilisateur.
    for (const duDepot of ["check:lang", "ticket:lint", "doc:anchors"]) {
      expect(proposes).not.toContain(duDepot);
    }
    // Aucun séparateur sans entrée sous lui : une section vide est une
    // promesse que le menu ne tient pas.
    menu.items.forEach((item, i) => {
      if (item.kind !== "separator") return;
      const suivant = menu.items[i + 1];
      expect(
        suivant !== undefined && suivant.kind === "choice",
        `section « ${item.label} » sans aucune entrée`,
      ).toBe(true);
    });
  });
});

describe("catalogue npm du menu — aucune entrée morte", () => {
  const gabarit = scriptsDuGabarit();
  const depot = scriptsDuDepot();

  it("le catalogue n'est pas vide (l'extraction MORD)", () => {
    // Sans cette garde, une extraction cassée rendrait « 0 entrée, 0 problème ».
    expect(NPM_SCRIPT_CATALOG.length).toBeGreaterThanOrEqual(10);
    expect(gabarit.size).toBeGreaterThanOrEqual(10);
    expect(depot.size).toBeGreaterThanOrEqual(10);
  });

  for (const entree of NPM_SCRIPT_CATALOG) {
    it(`« ${entree.script} » est fourni par l'app générée ou par le dépôt`, () => {
      expect(
        gabarit.has(entree.script) || depot.has(entree.script),
        `« ${entree.script} » n'existe NI dans le gabarit d'application ` +
          `(templates/app/base/package.json.tpl) NI dans le package.json du ` +
          `dépôt. Le menu filtrant sur l'existence, cette entrée est morte : ` +
          `elle ne s'affichera jamais, et rien ne le dirait.`,
      ).toBe(true);
    });
  }
});
