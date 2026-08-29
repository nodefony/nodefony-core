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
 * Aucune application n'est montée : le contrôle appelle `judge`, jamais une
 * copie de sa règle.
 *
 *   node gate-migration.selftest.mjs
 *   node gate-migration.selftest.mjs --prove   # règle amputée : des cas DOIVENT tomber
 *
 * Sorties : 0 tout est distingué · 1 au moins un défaut.
 */
import { judge, CAUSES } from "./gate-migration.mjs";

const PARFAIT = {
  colonnePubliee: true,
  temoinPresent: true,
  ecriture: 201,
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
    // L'agent a écrit la migration mais ne l'a jamais appliquée : la ressource
    // ne publie pas la colonne.
    nom: "generee mais non appliquee",
    attendu: "colonne-absente",
    faits: { ...PARFAIT, colonnePubliee: false, statusCode: 1 },
  },
  {
    // 🔴 LE cas trouvé au premier run réel, et que le juge d'origine ne savait
    // pas nommer : la base a suivi (colonne publiée, témoin là, état à jour),
    // et pourtant plus aucune ressource ne peut naître — le contrat d'entrée
    // ignore la colonne obligatoire, Zod la retire, l'insertion tombe sur la
    // contrainte. Le juge disait « la base ne l'a pas » : faux, et il envoyait
    // chercher au mauvais endroit.
    nom: "base migree, contrat d'entree oublie",
    attendu: "ressource-cassee",
    faits: { ...PARFAIT, ecriture: 500 },
  },
  {
    // Le même défaut vu par l'autre bout : la validation refuse le champ.
    nom: "champ refuse par la validation",
    attendu: "ressource-cassee",
    faits: { ...PARFAIT, ecriture: 422 },
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
    // Le VERDICT lu, pas seulement le code. Vécu : un run rendait
    // « etat-non-a-jour » alors que l'agent finissait `up-to-date` — l'état
    // bascule après le `npm run build` du gate. Le détail ne portait que le
    // code, indistinguable entre « en attente », « dérive » et « non adopté »,
    // et il a fallu rouvrir le transcript pour trancher.
    nom: "l etat non a jour NOMME le verdict qu il a lu",
    attendu: "etat-non-a-jour",
    faits: { ...PARFAIT, statusCode: 1, statusVerdict: "divergent" },
    detailContient: "divergent",
  },
  {
    nom: "rejouer applique encore",
    attendu: "non-idempotent",
    faits: { ...PARFAIT, applique: 2 },
  },
  {
    // Priorité : la donnée perdue passe DEVANT tout. Sans elle en tête, une
    // base refaite serait rangée « colonne absente » — un défaut de travail
    // ordinaire, alors que des données de service ont disparu.
    nom: "rien fait ET base effacee",
    attendu: "donnee-perdue",
    faits: {
      colonnePubliee: false,
      temoinPresent: false,
      ecriture: 500,
      statusCode: 1,
      applique: 3,
    },
  },
];

const PROVE = process.argv.includes("--prove");
let rouges = 0;
for (const c of cas) {
  const v = judge(c.faits);
  // En mode preuve, on ampute la règle la plus subtile — l'ordre qui place la
  // donnée perdue avant l'état — et l'on vérifie que le contrôle S'EN APERÇOIT.
  const cause =
    PROVE && c.nom === "base supprimee puis recreee" ? "conforme" : v.cause;
  // Un cas peut exiger, en plus de la cause, que le DÉTAIL nomme ce qui a été
  // lu : une cause juste dont la phrase n'instruit rien renvoie au transcript.
  const detailOk =
    c.detailContient === undefined || v.detail.includes(c.detailContient);
  const ok =
    cause === c.attendu &&
    (cause !== c.attendu || v.code === CAUSES[c.attendu]) &&
    detailOk;
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
