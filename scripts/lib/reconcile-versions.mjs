/**
 * La question qui décide d'une divergence de version : **existe-t-il UNE version
 * qui satisfait toutes les spécifications relevées ?**
 *
 * 🔴 Ce n'est PAS « les spécifications sont-elles identiques ». Des
 * spécifications qui divergent sur le papier ne dupliquent rien tant qu'une
 * seule version les satisfait toutes : npm dédoublonne. Vécu, et coûteux à
 * diagnostiquer — `zod` était déclaré de trois façons dans ce dépôt (`^4.4.3`
 * en quatorze sites, `4.6.0` en dépendance de développement, `^4.4.0` en
 * dépendance de pair), et une application générée compilait très bien : 4.6.0
 * satisfait les trois. Un contrôle qui aurait crié là-dessus aurait envoyé
 * réécrire quinze manifestes pour rien.
 *
 * Ce qui casse vraiment un arbre d'installation, c'est l'inverse : deux
 * spécifications qu'aucune version ne concilie. npm en installe alors deux
 * exemplaires, sans un mot — et deux copies d'une bibliothèque de TYPES ne
 * s'unifient pas, deux copies d'un registre à état global (ORM, greffons) ne se
 * voient pas l'une l'autre.
 *
 * Vit à part du script qui l'appelle pour être ÉPROUVABLE : `check-deps-latest`
 * s'exécute de bout en bout à l'import (dépôt git, requêtes au registre), donc
 * rien de ce qu'il contient ne se teste sans le lancer en entier.
 *
 * @module
 */

import semver from "semver";

/**
 * Dit si une version candidate satisfait toutes les plages données.
 *
 * Les spécifications que `semver` ne sait pas lire (`workspace:`, une URL, un
 * dépôt git) sont ÉCARTÉES plutôt que traitées comme un refus : elles ne
 * décrivent pas une version publiée, et les compter ferait rendre
 * « inconciliable » à des paquets locaux parfaitement sains.
 *
 * @param specs - les spécifications relevées, telles qu'écrites dans les manifestes.
 * @param candidats - versions concrètes à essayer (verrou, version publiée, bases
 *   des spécifications elles-mêmes).
 * @returns `true` si une candidate satisfait TOUTES les plages lisibles, `true`
 *   aussi quand il y a moins de deux plages lisibles ou aucune candidate — on ne
 *   conclut pas à un défaut faute de matière pour trancher.
 */
export function reconcilie(specs, candidats) {
  const plages = [...specs].filter((s) => semver.validRange(s) !== null);
  if (plages.length < 2) return true;
  const versions = [...candidats].filter((v) => semver.valid(v));
  if (versions.length === 0) return true;
  return versions.some((v) => plages.every((p) => semver.satisfies(v, p)));
}
