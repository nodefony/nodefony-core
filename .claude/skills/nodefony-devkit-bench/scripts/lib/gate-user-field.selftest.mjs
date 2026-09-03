#!/usr/bin/env node
/**
 * Auto-contrôle du juge « ajouter un champ à l'utilisateur d'une application en
 * service ».
 *
 * Ce qu'il éprouve, et pourquoi chaque cas existe :
 *
 *  1. les causes se DISTINGUENT — un juge qui rendrait la même cause pour deux
 *     situations différentes enverrait chercher au mauvais endroit ;
 *  2. l'ORDRE des causes — une base refaite répond juste à toutes les autres
 *     questions, et un compte externe dupliqué survit à un schéma parfait : si
 *     l'une ou l'autre passait après le travail demandé, on rendrait un défaut
 *     de finition là où des comptes ont été perdus ou doublés ;
 *  3. le succès n'est PAS le cas par défaut — le verdict conforme exige les six
 *     faits, pas l'absence de faute constatée ;
 *  4. la colonne « existe » et la colonne « se déploie » sont deux faits
 *     distincts : c'est toute la différence entre « ça marche chez moi » et un
 *     premier déploiement qui tient.
 *
 * Aucune application n'est montée : le contrôle appelle `judge`, jamais une
 * copie de sa règle.
 *
 *   node gate-user-field.selftest.mjs
 *   node gate-user-field.selftest.mjs --prove   # règle amputée : des cas DOIVENT tomber
 *
 * Sorties : 0 tout est distingué · 1 au moins un défaut.
 */
import { judge, jugerDecor, CAUSES } from "./gate-user-field.mjs";

const PARFAIT = {
  ancienPresent: true,
  comptesExternes: 1,
  creation: 201,
  statusCode: 0,
  colonneDeployee: true,
  applique: 0,
};

const cas = [
  {
    nom: "conforme",
    attendu: "conforme",
    faits: PARFAIT,
  },
  {
    // 🔴 LE cas qui justifie ce juge. La base a été supprimée et recréée : le
    // schéma est juste, l'état est à jour, une base vierge reçoit la colonne —
    // tout est vert sauf les comptes, qui n'existent plus. L'administrateur,
    // lui, renaît au démarrage et ne prouverait rien.
    nom: "base effacee puis recreee",
    attendu: "compte-perdu",
    faits: { ...PARFAIT, ancienPresent: false },
  },
  {
    // Le semis de l'application n'a même pas pu recréer le compte externe : ce
    // n'est plus un problème de recherche, c'est un démarrage en échec.
    nom: "aucun compte externe du tout",
    attendu: "compte-perdu",
    faits: { ...PARFAIT, comptesExternes: 0 },
  },
  {
    // 🔴 Le risque nommé au ticket #143, et il ne lève AUCUNE erreur : la
    // recherche par lien externe ne retrouve plus le compte, donc chaque
    // connexion en crée un nouveau. Le schéma est parfait, les données sont là.
    nom: "recherche par lien externe cassee",
    attendu: "compte-externe-double",
    faits: { ...PARFAIT, comptesExternes: 2 },
  },
  {
    // 🔴 Le piège que cette tâche existe pour attraper : un champ obligatoire
    // sans valeur par défaut SQL. Tout est vert — colonne posée, comptes
    // intacts, état à jour — et plus aucun compte ne peut naître, ni au semis
    // d'un administrateur ni à une première connexion externe.
    nom: "champ obligatoire sans defaut SQL",
    attendu: "creation-impossible",
    faits: { ...PARFAIT, creation: 500 },
  },
  {
    // Le même défaut vu par l'autre bout : la validation refuse la création.
    nom: "creation refusee par la validation",
    attendu: "creation-impossible",
    faits: { ...PARFAIT, creation: 422 },
  },
  {
    // Le champ est dans le code, la base ne l'a pas : le produit le dit lui-même
    // par le verdict `divergent`, et le détail doit le NOMMER — sans quoi il
    // faut rouvrir le transcript pour distinguer « en attente » d'une dérive.
    nom: "champ declare mais base non migree",
    attendu: "etat-non-a-jour",
    faits: { ...PARFAIT, statusCode: 1, statusVerdict: "divergent" },
    detailContient: "divergent",
  },
  {
    // 🔴 « Ça marche chez moi » : la colonne a été posée sur la base de
    // développement, jamais écrite dans une migration. L'état se dit à jour, les
    // comptes sont là, la création marche — et le premier déploiement n'aura
    // pas la colonne.
    nom: "colonne posee sur la base, hors migration",
    attendu: "colonne-non-deployable",
    faits: { ...PARFAIT, colonneDeployee: false },
  },
  {
    // Migrer une base vierge échoue : ce n'est pas « la colonne manque », c'est
    // « le déploiement tombe ». Deux gestes différents, deux causes.
    nom: "migration injouable sur une base vierge",
    attendu: "migration-injouable",
    faits: { ...PARFAIT, colonneDeployee: null },
  },
  {
    nom: "rejouer applique encore",
    attendu: "non-idempotent",
    faits: { ...PARFAIT, applique: 2 },
  },
  {
    // Priorité : la perte passe DEVANT tout. Sans elle en tête, une base refaite
    // serait rangée « colonne non déployable » — un défaut de finition, alors
    // que des comptes de service ont disparu.
    nom: "rien fait ET base effacee",
    attendu: "compte-perdu",
    faits: {
      ancienPresent: false,
      comptesExternes: 0,
      creation: 500,
      statusCode: 1,
      colonneDeployee: false,
      applique: 3,
    },
  },
  {
    // Priorité, second étage : le doublon passe devant le travail demandé. Un
    // agent qui a bien migré ET cassé la recherche externe doit lire le
    // doublon, pas « conforme ».
    nom: "doublon externe malgre un schema parfait",
    attendu: "compte-externe-double",
    faits: { ...PARFAIT, comptesExternes: 3 },
  },
];

const PROVE = process.argv.includes("--prove");
let rouges = 0;
for (const c of cas) {
  const v = judge(c.faits);
  // En mode preuve, on ampute les deux règles les plus subtiles — l'ordre qui
  // place la perte de comptes avant tout, et la distinction entre une colonne
  // qui EXISTE et une colonne qui se DÉPLOIE — et l'on vérifie que le contrôle
  // s'en aperçoit.
  const ampute =
    c.nom === "base effacee puis recreee" ||
    c.nom === "colonne posee sur la base, hors migration";
  const cause = PROVE && ampute ? "conforme" : v.cause;
  const detailOk =
    c.detailContient === undefined || v.detail.includes(c.detailContient);
  const ok = cause === c.attendu && v.code === CAUSES[cause] && detailOk;
  if (!ok) {
    rouges += 1;
    const pourquoi = !detailOk
      ? `le détail ne nomme pas « ${c.detailContient} » : ${v.detail}`
      : `attendu « ${c.attendu} », obtenu « ${cause} »`;
    console.error(`✗ ${c.nom} : ${pourquoi}`);
  } else {
    console.log(`✓ ${c.nom} → ${cause} (${v.code})`);
  }
}
// ─── Le décor, relu avant que l'agent n'arrive ────────────────────────────────
// La prémisse sème par deux chemins différents, et une commande qui rend `0` ne
// prouve pas qu'une ligne est en base. Ces trois cas éprouvent la relecture.
const casDecor = [
  {
    nom: "decor pose",
    faits: { ancienPresent: true, comptesExternes: 1 },
    ok: true,
  },
  {
    nom: "compte seme absent",
    faits: { ancienPresent: false, comptesExternes: 1 },
    ok: false,
  },
  {
    nom: "semis externe non joue",
    faits: { ancienPresent: true, comptesExternes: 0 },
    ok: false,
  },
  {
    // Le décor lui-même doit refuser un doublon PRÉEXISTANT : sinon l'agent
    // hériterait d'un état déjà fautif et porterait un rouge qui n'est pas le sien.
    nom: "doublon deja present avant l agent",
    faits: { ancienPresent: true, comptesExternes: 2 },
    ok: false,
  },
];
for (const c of casDecor) {
  const v = jugerDecor(c.faits);
  if (v.ok !== c.ok) {
    rouges += 1;
    console.error(`✗ décor/${c.nom} : attendu ok=${c.ok}, obtenu ok=${v.ok}`);
  } else {
    console.log(`✓ décor/${c.nom} → ok=${v.ok}`);
  }
}

if (PROVE) {
  if (rouges === 0) {
    console.error(
      "✗ la règle amputée n'a fait tomber AUCUN cas : le contrôle ne discrimine pas",
    );
    process.exit(1);
  }
  console.log(`✓ règle amputée → ${rouges} cas tombé(s), le contrôle mord`);
  process.exit(0);
}
process.exit(rouges === 0 ? 0 : 1);
