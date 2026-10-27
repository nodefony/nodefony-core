/**
 * Auto-contrôle du plan d'évolution (oracle → renommages, suppressions).
 *
 * Le défaut qu'il ferme : le banc d'évolution déclare à `orm:generate` ce que
 * ce module lit dans le script de passage. Un renommage qu'il rate devient une
 * suppression déclarée, et le banc la « prouve » ; un renommage qu'il invente
 * fait refuser une génération juste. Chaque règle a donc son cas, écrit à la
 * main dans le style du corpus (aucune ligne d'un corpus tiers n'est copiée).
 *
 * Usage : `node lib/schema-evolution-plan.selftest.mjs`
 * Sorties : `0` toutes les règles tiennent · `1` au moins un écart.
 *
 * @module
 */
import { isDeepStrictEqual } from "node:util";
import {
  namesDrop,
  parseOracleMigration,
  planEvolution,
  splitScript,
  withoutDrops,
} from "./schema-evolution-plan.mjs";

let green = 0;
const red = [];
const same = (name, actual, expected) => {
  if (isDeepStrictEqual(actual, expected)) green += 1;
  else {
    red.push(
      `${name} — rendu ${JSON.stringify(actual)}, attendu ${JSON.stringify(expected)}`,
    );
  }
};

const SCRIPT = `
-- To rename a column:      ALTER TABLE app_table CHANGE COLUMN oldname newname varchar(60);
-- VMYSQL4.3 ALTER TABLE app_doc CHANGE COLUMN rowid rowid INTEGER NOT NULL AUTO_INCREMENT;
ALTER TABLE app_note CHANGE COLUMN titre title varchar(50) NOT NULL;
ALTER TABLE app_line CHANGE COLUMN fk_old fk_first integer; -- avant le renommage de la table
ALTER TABLE app_line RENAME TO app_row;
ALTER TABLE \`app_row\` CHANGE \`fk_other\` \`fk_second\` integer;
ALTER TABLE app_note CHANGE COLUMN label label varchar(255);
ALTER TABLE app_note MODIFY COLUMN label varchar(255);
ALTER TABLE app_note DROP INDEX idx_app_note_label;
ALTER TABLE app_doc DROP COLUMN legacy;
DROP TABLE IF EXISTS app_trash;
UPDATE app_note SET title = 'x' WHERE title IS NULL;
INSERT INTO app_dict (code) VALUES ('A;B');
DELETE FROM app_note WHERE fk_doc NOT IN (SELECT rowid FROM app_doc);
`;

const oracle = parseOracleMigration(SCRIPT);
same("une table renommée", oracle.tableRenames, [
  { from: "app_line", to: "app_row" },
]);
same(
  "renommages de colonne : nom FINAL de la table, avant comme après son renommage ; CHANGE a a ignoré ; commentaires ignorés",
  oracle.columnRenames,
  [
    { table: "app_note", from: "titre", to: "title" },
    { table: "app_row", from: "fk_old", to: "fk_first" },
    { table: "app_row", from: "fk_other", to: "fk_second" },
  ],
);
same(
  "suppressions : DROP COLUMN et DROP TABLE, jamais DROP INDEX",
  oracle.drops,
  [{ table: "app_doc", column: "legacy" }, { table: "app_trash" }],
);
// Le `;` dans une chaîne coupe l'INSERT en deux : le compte des données est
// une indication pour le rapport, jamais une décision.
same("instructions de données comptées", oracle.dataStatements, 3);
same(
  "commentaire de fin de ligne retiré",
  splitScript("ALTER TABLE t DROP COLUMN c; -- note ; piège\nSELECT 1"),
  ["ALTER TABLE t DROP COLUMN c", "SELECT 1"],
);

const col = (kind, extra = {}) => ({ kind, ...extra });
const FROM = [
  {
    name: "app_doc",
    columns: {
      rowid: col("serial", { primaryKey: true }),
      legacy: col("int"),
      old_flag: col("int"),
    },
  },
  {
    name: "app_note",
    columns: {
      rowid: col("serial", { primaryKey: true }),
      titre: col("string"),
      label: col("string"),
    },
    indexes: [{ name: "idx_flag", on: ["label"] }],
  },
  {
    name: "app_line",
    columns: {
      rowid: col("serial", { primaryKey: true }),
      fk_old: col("int"),
      fk_other: col("int"),
    },
  },
  {
    name: "app_trash",
    columns: { rowid: col("serial", { primaryKey: true }) },
  },
  { name: "app_gone", columns: { rowid: col("serial", { primaryKey: true }) } },
];
const TO = [
  {
    name: "app_doc",
    columns: { rowid: col("serial", { primaryKey: true }), fresh: col("int") },
  },
  {
    name: "app_note",
    columns: {
      rowid: col("serial", { primaryKey: true }),
      title: col("string"),
    },
  },
  {
    name: "app_row",
    columns: {
      rowid: col("serial", { primaryKey: true }),
      fk_first: col("int"),
      fk_second: col("int"),
    },
  },
  { name: "app_new", columns: { rowid: col("serial", { primaryKey: true }) } },
];
const plan = planEvolution({
  from: FROM,
  to: TO,
  oracle: parseOracleMigration(
    `${SCRIPT}\nALTER TABLE app_ghost RENAME TO app_phantom;\nALTER TABLE app_note CHANGE COLUMN nope yes integer;`,
  ),
});
same(
  "renommages déclarés au format --rename (colonne d'une table renommée = NOUVEAU nom)",
  plan.renames,
  [
    "app_line=app_row",
    "app_note.titre=title",
    "app_row.fk_old=fk_first",
    "app_row.fk_other=fk_second",
  ],
);
same("suppressions : voulues ET abandonnées, en noms de départ", plan.drops, [
  "app_doc.legacy",
  "app_doc.old_flag",
  "app_note.label",
  "app_trash",
  "app_gone",
]);
same("voulues par l'oracle", plan.declaredDrops, [
  "app_doc.legacy",
  "app_trash",
]);
same("abandonnées par la forme d'installation", plan.abandoned, [
  "app_doc.old_flag",
  "app_note.label",
  "app_gone",
]);
same(
  "renommages de l'oracle qui ne s'appliquent pas : NOMMÉS",
  plan.notApplied.map((n) => n.what),
  ["table app_ghost → app_phantom", "colonne app_note.nope → yes"],
);
same(
  "état intermédiaire : colonnes, tables et index des suppressions retirés",
  plan.between.map((s) => [s.name, Object.keys(s.columns), s.indexes ?? null]),
  [
    ["app_doc", ["rowid"], null],
    ["app_note", ["rowid", "titre"], []],
    ["app_line", ["rowid", "fk_old", "fk_other"], null],
  ],
);

let refused = "";
try {
  withoutDrops(
    [
      { name: "a", columns: { id: col("serial") } },
      { name: "b", columns: { fk: col("ref", { target: "a" }) } },
    ],
    new Set(["a"]),
  );
} catch (error) {
  refused = error instanceof Error ? error.message : String(error);
}
same(
  "une table conservée qui vise une table supprimée : refus nommé",
  refused,
  "b.fk référence a, que l'évolution supprime",
);

same(
  "suppression NOMMÉE : identifiants entiers, table ET colonne",
  [
    namesDrop(
      "ALTER TABLE `llx_user` DROP COLUMN `egroupware_id`;",
      "llx_user.egroupware_id",
    ),
    namesDrop(
      "ALTER TABLE llx_user_rights DROP COLUMN egroupware_id",
      "llx_user.egroupware_id",
    ),
    namesDrop("ALTER TABLE llx_task DROP COLUMN fk_status", "llx_task.status"),
    namesDrop('DROP TABLE "llx_log" CASCADE', "llx_log"),
    namesDrop("ALTER TABLE llx_log DROP COLUMN x", "llx_log.y"),
  ],
  [true, false, false, true, false],
);

if (red.length > 0) {
  console.error(
    `schema-evolution-plan : ${red.length} règle(s) rouge(s), ${green} verte(s)`,
  );
  for (const r of red) console.error(`  ✗ ${r}`);
  process.exit(1);
}
console.log(`schema-evolution-plan : ${green} règles vertes`);
