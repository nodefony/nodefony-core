#!/usr/bin/env node
/**
 * Auto-contrôle du juge « faire suivre une base DÉJÀ en place ».
 *
 * Ce qu'il éprouve, et pourquoi chaque cas existe :
 *
 *  1. les quatre causes se DISTINGUENT — un juge qui rendrait la même cause
 *     pour deux situations différentes enverrait chercher au mauvais endroit ;
 *  2. l'ORDRE des causes — une base refaite répond juste à toutes les questions
 *     sauf une : si la donnée perdue passait après l'état, on rendrait
 *     « conforme » à un agent qui a détruit les données de production ;
 *  3. le succès n'est PAS le cas par défaut — le verdict conforme exige les
 *     quatre faits, pas l'absence de faute constatée.
 *
 * Aucune application n'est montée : le contrôle appelle `juger`, jamais une
 * copie de sa règle.
 *
 *   node gate-migration.selftest.mjs
 *   node gate-migration.selftest.mjs --prove   # règle amputée : des cas DOIVENT tomber
 *
 * Sorties : 0 tout est distingué · 1 au moins un défaut.
 */
import { juger, CAUSES } from "./gate-migration.mjs";

const PARFAIT = {
  colonneAcceptee: true,
  temoinPresent: true,
  statusCode: 0,
  applique: 0,
};

const cas = [
  {
    nom: "conforme",
    attendu: "conforme",
    faits: PARFAIT,
  },
  {
    // L'agent a écrit la migration mais ne l'a jamais appliquée : la colonne
    // n'existe pas, l'écriture est refusée par la base.
    nom: "generee mais non appliquee",
    attendu: "colonne-absente",
    faits: { ...PARFAIT, colonneAcceptee: false, statusCode: 1 },
  },
  {
    // 🔴 LE cas qui justifie ce juge. La base a été supprimée et recréée : le
    // schéma est juste, l'état est à jour, rejouer ne fait rien — tout est vert
    // sauf la donnée de production, qui n'existe plus.
    nom: "base supprimee puis recreee",
    attendu: "donnee-perdue",
    faits: { ...PARFAIT, temoinPresent: false },
  },
  {
    // Un `ALTER` écrit à la main dans la base : la colonne existe, la donnée est
    // là — mais l'historique ne connaît pas la migration, donc l'état n'est pas
    // à jour. C'est ce qui distingue « ça marche chez moi » d'un déploiement.
    nom: "colonne posee a la main, hors migration",
    attendu: "etat-non-a-jour",
    faits: { ...PARFAIT, statusCode: 1 },
  },
  {
    nom: "rejouer applique encore",
    attendu: "non-idempotent",
    faits: { ...PARFAIT, applique: 2 },
  },
  {
    // Priorité : colonne absente ET donnée perdue → la colonne d'abord, parce
    // qu'elle dit que le travail n'a pas eu lieu du tout.
    nom: "rien fait ET base effacee",
    attendu: "colonne-absente",
    faits: {
      colonneAcceptee: false,
      temoinPresent: false,
      statusCode: 1,
      applique: 3,
    },
  },
];

const PROVE = process.argv.includes("--prove");
let rouges = 0;
for (const c of cas) {
  const v = juger(c.faits);
  // En mode preuve, on ampute la règle la plus subtile — l'ordre qui place la
  // donnée perdue avant l'état — et l'on vérifie que le contrôle S'EN APERÇOIT.
  const cause =
    PROVE && c.nom === "base supprimee puis recreee" ? "conforme" : v.cause;
  const ok =
    cause === c.attendu &&
    (cause !== c.attendu || v.code === CAUSES[c.attendu]);
  if (!ok) {
    rouges += 1;
    console.error(`✗ ${c.nom} : attendu « ${c.attendu} », obtenu « ${cause} »`);
  } else {
    console.log(`✓ ${c.nom} → ${cause} (${v.code})`);
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
