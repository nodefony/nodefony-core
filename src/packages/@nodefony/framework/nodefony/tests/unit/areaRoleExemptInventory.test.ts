/// <reference types="node" />
import { expect } from "chai";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `areaRoleExempt` RETIRE une garde : il soustrait une route au rôle exigé par
// défaut dans sa zone du firewall. Posé sur une route qui ne décide de rien, il
// la rend accessible à tout compte connecté — sans erreur, sans journal, et
// sans que rien ne le signale à la relecture.
//
// Le risque n'est pas théorique : c'est le geste qu'on fait quand on bute sur
// un refus et qu'on cherche à avancer. Un nom, un commentaire et une TSDoc ne
// l'empêchent pas ; seul un contrôle qui ÉCHOUE l'empêche.
//
// Les deux producteurs légitimes sont internes au framework et énumérés ici.
// Ajouter une entrée est une décision qui se relit en revue — c'est tout
// l'intérêt de devoir toucher ce fichier.

const ICI = path.dirname(fileURLToPath(import.meta.url));
/** Racine du paquet `@nodefony/framework` (ce test vit dans `nodefony/tests/unit`). */
const RACINE = path.resolve(ICI, "..", "..", "..");

/**
 * Fichiers autorisés à poser la dispense, chemin relatif à la racine du paquet.
 *
 * - le pont du plan d'administration : UNE route pour tous les points d'entrée,
 *   dont le rôle se résout par point d'entrée (`resolveAdminRole`) ;
 * - les clés personnelles : l'action est scopée au porteur courant
 *   (`authFlow.me`), jamais à un paramètre ;
 * - le 2FA self-service : même raison, le sujet est l'utilisateur courant
 *   (`#currentSubject()`) — on n'active jamais le second facteur d'autrui.
 */
const PRODUCTEURS_AUTORISES = new Set([
  path.join("nodefony", "service", "AdminBroker.ts"),
  path.join("nodefony", "controller", "ApiKeyController.ts"),
  path.join("nodefony", "controller", "TotpController.ts"),
]);

/** Fichiers où la dispense se DÉFINIT (et non se pose) — hors inventaire. */
const DEFINITIONS = new Set([
  path.join("nodefony", "src", "Route.ts"),
  path.join("nodefony", "src", "Resolver.ts"),
]);

/** Tous les `.ts` du paquet, hors build, dépendances et tests. */
function sourcesDuPaquet(dir: string, acc: string[] = []): string[] {
  for (const entree of readdirSync(dir)) {
    if (
      entree === "node_modules" ||
      entree === "dist" ||
      entree === "tests" ||
      entree === "frontend"
    ) {
      continue;
    }
    const complet = path.join(dir, entree);
    if (statSync(complet).isDirectory()) {
      sourcesDuPaquet(complet, acc);
    } else if (entree.endsWith(".ts") && !entree.endsWith(".d.ts")) {
      acc.push(complet);
    }
  }
  return acc;
}

/** Les fichiers qui POSENT la dispense (`areaRoleExempt: true`). */
function poseursDeDispense(): string[] {
  const trouves: string[] = [];
  for (const fichier of sourcesDuPaquet(RACINE)) {
    const relatif = path.relative(RACINE, fichier);
    if (DEFINITIONS.has(relatif)) continue;
    if (/areaRoleExempt\s*:\s*true/u.test(readFileSync(fichier, "utf8"))) {
      trouves.push(relatif);
    }
  }
  return trouves;
}

describe("Dispense de rôle de zone — inventaire des producteurs", () => {
  it("aucun fichier hors des producteurs déclarés ne pose la dispense", () => {
    const intrus = poseursDeDispense().filter(
      (f) => !PRODUCTEURS_AUTORISES.has(f),
    );
    expect(
      intrus,
      `ces fichiers soustraient une route au rôle de sa zone sans être des ` +
        `producteurs déclarés :\n${intrus.join("\n")}\n` +
        `Une route d'application se protège par une garde (\`@IsGranted\`), pas ` +
        `en retirant celle de sa zone. Si l'usage est légitime, l'ajouter à ` +
        `PRODUCTEURS_AUTORISES et dire POURQUOI dans ce fichier.`,
    ).to.deep.equal([]);
  });

  // Le pendant : une exception qui ne sert plus est une porte ouverte qu'on a
  // oublié de refermer. Le jour où un producteur cesse d'en avoir besoin, il
  // sort de la liste.
  it("chaque producteur déclaré pose RÉELLEMENT la dispense", () => {
    const poseurs = new Set(poseursDeDispense());
    for (const attendu of PRODUCTEURS_AUTORISES) {
      expect(
        poseurs.has(attendu),
        `${attendu} est autorisé à poser la dispense mais ne la pose plus : ` +
          `retirer l'entrée, sinon elle couvrira autre chose un jour.`,
      ).to.equal(true);
    }
  });

  // Le balayage lui-même doit mordre : s'il ne lit aucun fichier, les deux
  // contrôles ci-dessus passent pour la plus mauvaise des raisons.
  it("le balayage lit bien les sources du paquet", () => {
    const sources = sourcesDuPaquet(RACINE);
    expect(sources.length, "sources du paquet balayées").to.be.greaterThan(20);
    expect(poseursDeDispense().length, "producteurs trouvés").to.be.greaterThan(
      0,
    );
  });
});
