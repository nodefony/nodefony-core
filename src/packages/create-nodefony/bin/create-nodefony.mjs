#!/usr/bin/env node
/**
 * `npm create nodefony <nom>` — la porte d'entrée SANS installation globale.
 *
 * ── POURQUOI CE PAQUET EXISTE ───────────────────────────────────────────────
 *
 * Créer une application Nodefony imposait jusqu'ici un `npm i -g nodefony`.
 * Une installation globale est le premier obstacle d'un onboarding : elle
 * demande une décision (et parfois des droits) AVANT que quiconque ait vu ce
 * que le framework produit, et elle épingle une version pour toute la machine
 * — deux projets sur deux majeures deviennent alors incompatibles.
 *
 * `npm create <nom>` résout exactement ce problème : npm télécharge
 * `create-<nom>` dans un cache jetable, l'exécute, et n'installe rien.
 *
 * ── CE QU'IL NE FAIT PAS, ET C'EST TOUT L'INTÉRÊT ───────────────────────────
 *
 * Il ne scaffolde RIEN. Le générateur vit dans le cœur (`nodefony create app`)
 * et reste la seule implémentation. Un second générateur ici — même « juste
 * pour le cas simple » — dériverait du premier en silence : deux gabarits, deux
 * jeux de règles, et un utilisateur sur deux qui obtient l'ancienne version.
 * Ce fichier ne fait donc qu'une chose : trouver le lanceur, et lui passer la
 * main avec les arguments reçus tels quels.
 *
 * ── POURQUOI `nodefony` EST UNE DÉPENDANCE, ÉPINGLÉE ────────────────────────
 *
 * Verrouillée sur la MÊME version (lockstep) : `create-nodefony@10.0.0`
 * scaffolde toujours avec le cœur `10.0.0`. Passer par un `npx nodefony@latest`
 * à la volée rendrait le résultat dépendant du moment de l'exécution — et le
 * téléchargement n'est pas perdu : l'application générée a besoin de ce même
 * paquet.
 */
import { spawnSync } from "node:child_process";
import process from "node:process";

// ⚠️ IMPORT DYNAMIQUE, et c'est la seule forme qui marche. Un `import` statique
// de `nodefony` est résolu par Node AVANT que la moindre ligne de ce fichier ne
// s'exécute : le `try/catch` ci-dessous ne serait jamais atteint, et celui qui
// découvre le framework recevrait une trace de pile interne à la place d'une
// phrase. Constaté en débranchant le paquet, pas déduit.
//
// La résolution part d'ICI, pas du cœur : ce shim est installé À CÔTÉ du
// framework, dans un arbre que npm vient de fabriquer. `import.meta.url` fait
// donc partir la recherche du bon endroit, quel que soit le hoisting.
let lanceur;
try {
  const { nodefonyBin } = await import("nodefony");
  lanceur = nodefonyBin(import.meta.url);
} catch (e) {
  console.error(
    `\n✗ le paquet \`nodefony\` est introuvable depuis ce shim.\n  ${e.message}\n\n` +
      "  Ce n'est pas un défaut de votre commande : `create-nodefony` déclare\n" +
      "  `nodefony` en dépendance, donc son absence signale une installation\n" +
      "  interrompue. Réessayer, ou `npm cache clean --force` puis réessayer.\n",
  );
  process.exit(1);
}

// Le lanceur est un SCRIPT, jamais un exécutable : il se donne à `node`. Sous
// Windows, `node_modules/.bin/nodefony` n'existe pas — npm y écrit un `.cmd`
// que Node refuse d'exécuter sans shell (CVE-2024-27980). Passer par
// `process.execPath` évite le sujet entièrement : aucun shell n'est ouvert,
// donc aucun argument n'est réinterprété par lui.
const args = process.argv.slice(2);
const r = spawnSync(process.execPath, [lanceur, "create", "app", ...args], {
  stdio: "inherit",
});

// Un process tué par un signal n'a pas de code de sortie : sans cette branche,
// `r.status` vaut `null` et `process.exit(null)` rendrait 0 — un échec qui se
// présente comme un succès, à celui-là même qui découvre le framework.
if (r.error) {
  console.error(`\n✗ impossible de lancer le générateur : ${r.error.message}\n`);
  process.exit(1);
}
process.exit(r.status === null ? 1 : r.status);
