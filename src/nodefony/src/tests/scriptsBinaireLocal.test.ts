/**
 * Aucun script du dépôt n'appelle le binaire `nodefony` par son NOM.
 *
 * Le trou qu'il ferme, et il a coûté une chaîne d'intégration rouge sur les six
 * combinaisons de plateformes : `src/nodefony/bin/nodefony` est **produit par le
 * build** et gitignoré. Sur un checkout vierge, `npm ci` ne peut donc pas poser
 * `node_modules/.bin/nodefony` — la cible n'existe pas encore —, et le lien
 * n'est pas rattrapé après le build. Un script écrit `nodefony frontend:build`
 * marche alors chez le développeur, dont l'environnement porte le lien d'une
 * installation antérieure ou un binaire GLOBAL, et échoue partout ailleurs sur
 * `command not found`.
 *
 * C'est le motif « ce que j'exécute n'est pas ce que le consommateur exécute »
 * sous sa forme la plus traître : la commande fautive est identique, seul
 * l'environnement diffère — et l'environnement du développeur est le seul qui
 * ne ressemble à aucun autre.
 *
 * La forme qui tient est l'appel DIRECT : `node src/nodefony/bin/nodefony …`.
 * Elle ne dépend d'aucun lien, d'aucun `PATH`, et se comporte pareil sur les
 * trois systèmes. C'est déjà la règle des scripts de démarrage du dépôt.
 *
 * `npx nodefony` est refusé pour la même raison, aggravée : à défaut de lien,
 * `npx` va CHERCHER le paquet sur le registre au lieu d'échouer — on croit
 * exercer le dépôt, on exerce une version publiée.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);

/** Chemin d'affichage : un chemin qui VOYAGE s'écrit en `/`. */
const show = (p: string): string =>
  path.relative(RACINE, p).split(path.sep).join("/");

/**
 * Un appel au binaire par son nom, ou par `npx` — pas un chemin.
 *
 * `node …/bin/nodefony` et `node_modules/.bin/nodefony` sont acceptés : le
 * premier est la forme recommandée, le second désigne explicitement le lien et
 * ne peut donc pas être confondu avec une résolution par `PATH`.
 */
const APPEL_FRAGILE = /(?:^|&&\s*|;\s*|\|\|\s*)(?:npx\s+)?nodefony\s+[a-z]/;

describe("scripts du dépôt — le binaire s'appelle par son CHEMIN", () => {
  it("aucun script npm n'invoque `nodefony` par son nom", () => {
    const manifestes = [
      path.join(RACINE, "package.json"),
      path.join(RACINE, "src", "nodefony", "package.json"),
    ].filter((p) => existsSync(p));
    expect(manifestes.length).toBeGreaterThan(0);

    const fautifs: string[] = [];
    for (const manifeste of manifestes) {
      const pkg = JSON.parse(readFileSync(manifeste, "utf8")) as {
        scripts?: Record<string, string>;
      };
      for (const [nom, commande] of Object.entries(pkg.scripts ?? {})) {
        if (APPEL_FRAGILE.test(commande)) {
          fautifs.push(`${show(manifeste)} → ${nom}: ${commande}`);
        }
      }
    }

    expect(
      fautifs,
      "Ces scripts appellent le binaire par son NOM. `bin/nodefony` étant produit\n" +
        "par le build et gitignoré, `npm ci` ne pose pas le lien `.bin` sur un\n" +
        "checkout vierge : la commande échoue en intégration continue et marche\n" +
        "chez qui a un binaire global.\n" +
        "→ écrire `node src/nodefony/bin/nodefony <commande>`.\n",
    ).toEqual([]);
  });

  it("aucune étape de la forge n'invoque `nodefony` par son nom", () => {
    const flux = path.join(RACINE, ".github", "workflows");
    if (!existsSync(flux)) return;
    const fautifs: string[] = [];
    for (const nom of readdirSync(flux)) {
      if (!/\.ya?ml$/.test(nom)) continue;
      const fichier = path.join(flux, nom);
      readFileSync(fichier, "utf8")
        .split("\n")
        .forEach((ligne, i) => {
          // Les commentaires citent des commandes pour les expliquer.
          if (/^\s*#/.test(ligne)) return;
          if (APPEL_FRAGILE.test(ligne)) {
            fautifs.push(`${show(fichier)}:${i + 1} ${ligne.trim()}`);
          }
        });
    }
    expect(
      fautifs,
      "Ces étapes appellent le binaire par son NOM — même cause, même effet.\n" +
        "→ écrire `node src/nodefony/bin/nodefony <commande>`.\n",
    ).toEqual([]);
  });
});
