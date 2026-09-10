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
  // 🔴 La disjonction se PROUVE sans réseau, et il faut la prouver là : sinon un
  // paquet absent du verrou et déclaré par deux plages complexes (`>=1 <2` et
  // `>=2 <3`) n'a AUCUNE candidate, « aucune candidate » vaut conciliable, et la
  // garde devient plus CLÉMENTE quand le registre se tait — exactement l'inverse
  // de ce qu'elle promet. Deux plages sans intersection ne se concilient jamais,
  // quelles que soient les versions publiées.
  //
  // Bornée aux plages SANS préversion : `semver.intersects` se trompe dans les
  // deux sens dès qu'un `-` apparaît (`^1.0.0-alpha.1` et `1.0.0-alpha.3` sont
  // rendus disjoints alors qu'ils se concilient), et un contrôle qui crie sur du
  // sain finit désarmé.
  const sansPre = plages.filter((p) => !p.includes("-"));
  for (let i = 0; i < sansPre.length; i++) {
    for (let j = i + 1; j < sansPre.length; j++) {
      if (!semver.intersects(sansPre[i], sansPre[j])) return false;
    }
  }
  const versions = [...candidats].filter((v) => semver.valid(v));
  if (versions.length === 0) return true;
  return versions.some((v) => plages.every((p) => semver.satisfies(v, p)));
}

/**
 * Dit si le dépôt recevra PLUSIEURS exemplaires d'un paquet, en ne regardant que
 * ce qu'il possède.
 *
 * 🔴 Pourquoi cette question s'ajoute à `reconcilie` : npm ne cherche pas « la
 * version qui satisfait tout le monde ». Il ne remplace une copie déjà posée que
 * par une version SUPÉRIEURE ou égale ; redescendre n'est autorisé que pour les
 * arêtes de pair. Une spécification EXACTE dominée par une plage plus haute ne
 * produit donc pas un conflit — elle produit une copie IMBRIQUÉE, et
 * `reconcilie` la déclare conciliable en toute bonne foi : la version exacte
 * satisfait bien les deux, elle n'est simplement pas celle que npm posera.
 *
 * Le verrou tranche sans réseau et sans installation : si plusieurs versions
 * coexistent aux emplacements que le dépôt POSSÈDE, l'arbre est déjà dédoublé.
 * Les copies rangées sous un paquet tiers ne comptent pas — elles appartiennent
 * à ce tiers, pas à nous.
 *
 * @param versionsPossedees - versions du paquet aux emplacements du dépôt.
 * @param specsPossedees - spécifications déclarées par le dépôt (hors pair).
 * @returns `true` si l'arbre est, ou sera, dédoublé.
 */
export function dedouble(versionsPossedees, specsPossedees) {
  const versions = [...versionsPossedees].filter((v) => semver.valid(v));
  if (versions.length > 1) return true;
  if (versions.length === 0) return false;
  const plages = [...specsPossedees].filter(
    (s) => semver.validRange(s) !== null,
  );
  if (plages.length < 2) return false;
  return !plages.every((p) => semver.satisfies(versions[0], p));
}

/**
 * La plus haute version PUBLIÉE qu'une plage accepte — ce que recevrait un
 * `npm install` aujourd'hui.
 *
 * 🔴 Pourquoi cette question EXISTE, alors que `dist-tags.latest` semble y
 * répondre : `latest` n'est pas « la dernière version », c'est ce que le
 * mainteneur a choisi de servir par défaut. `@types/node` publie ses versions
 * par LIGNE DE TYPESCRIPT (`ts6.0` → 26.5.1) et laisse `latest` sur **22.20.2**,
 * la ligne compatible avec les vieux compilateurs. Un dépôt en 26.4.1 apparaît
 * donc « en avance sur latest » tout en accumulant du retard sur sa propre
 * ligne, et aucun outil ne le dit — ni `npm outdated`, ni ce rapport avant.
 *
 * Pas de `includePrerelease` : `npm install` ne sert jamais une préversion à une
 * plage ordinaire. L'activer faisait annoncer `@angular/core` en retard sur un
 * `22.2.0-next.7` que personne ne recevra. Une plage qui porte elle-même une
 * préversion (`^7.0.0-dev.x`) reste servie par semver.
 *
 * @param versions - les versions publiées, telles que le registre les rend.
 * @param spec - la plage déclarée dans un manifeste.
 * @returns la version, ou `null` si la plage est illisible ou qu'aucune ne convient.
 */
export function plusHauteSatisfaisante(versions, spec) {
  if (!versions || semver.validRange(spec) === null) return null;
  return semver.maxSatisfying([...versions], spec);
}
