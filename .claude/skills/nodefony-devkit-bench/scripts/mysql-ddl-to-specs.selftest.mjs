/**
 * Auto-contrôle du convertisseur DDL MySQL → descriptions neutres.
 *
 * Le défaut qu'il ferme : un convertisseur se juge sur 421 tables qu'on ne
 * relit pas. Une règle qui glisse — un `double(24,8)` rendu flottant, une clé
 * étrangère avalée par la clé primaire, un `--` collé lu comme du SQL — ne se
 * voit dans aucun compte global. Chaque traduction a donc ici son cas, écrit à
 * la main dans le style du corpus `erp` (aucune ligne d’un corpus tiers n’est copiée).
 *
 * Usage : `node mysql-ddl-to-specs.selftest.mjs`
 * Sorties : `0` toutes les règles tiennent · `1` au moins un écart.
 *
 * @module
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { findRepoRoot } from "./corpus-fetch.mjs";
import {
  convertCorpus,
  domainOf,
  readCorpusDir,
  splitStatements,
} from "./mysql-ddl-to-specs.mjs";

let green = 0;
const red = [];
const rule = (name, ok, detail = "") => {
  if (ok) green += 1;
  else red.push(`${name}${detail ? ` — ${detail}` : ""}`);
};
const same = (name, actual, expected) =>
  rule(
    name,
    isDeepStrictEqual(actual, expected),
    `rendu ${JSON.stringify(actual)}, attendu ${JSON.stringify(expected)}`,
  );

const TABLES = [
  {
    file: "app_shop.sql",
    sql: `--Dictionary of shops
-- a comment with ; inside
create table app_shop
(
  rowid        integer AUTO_INCREMENT PRIMARY KEY,
  code         varchar(3) NOT NULL,       --collé, comme dans le corpus erp
  label        varchar(128) DEFAULT 'l''été --',
  total_ht     double(24,8) DEFAULT 0,
  ratio        real DEFAULT 0.5,
  status       smallint DEFAULT 0 NOT NULL,
  flag         tinyint DEFAULT 1,
  big_counter  integer unsigned,
  ext_id       bigint,
  opened       date DEFAULT '2000-01-01',
  active       boolean DEFAULT 1,
  extra        json,
  note         mediumtext,
  geopoint     point,
  datec        datetime DEFAULT CURRENT_TIMESTAMP,
  tms          timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  fk_parent    integer,
  fk_country   varchar(3),
  fk_user      integer DEFAULT 0 NOT NULL
) ENGINE=innodb;`,
  },
  {
    file: "app_user.sql",
    sql: "create table app_user ( rowid integer AUTO_INCREMENT PRIMARY KEY, login varchar(50) NOT NULL ) ENGINE=innodb;",
  },
  {
    file: "app_country.sql",
    sql: "create table app_country ( rowid integer PRIMARY KEY, code varchar(3) NOT NULL ) ENGINE=innodb;",
  },
  {
    file: "app_shop_user.sql",
    sql: "create table app_shop_user ( fk_shop integer NOT NULL, fk_user integer NOT NULL ) ENGINE=innodb;",
  },
  {
    file: "app_log.sql",
    sql: "create table app_log ( message text ) ENGINE=innodb;",
  },
  {
    file: "app_zone.sql",
    sql: "create table app_zone ( rowid integer AUTO_INCREMENT PRIMARY KEY, code varchar(3) ) ENGINE=innodb;",
  },
];
const KEYS = [
  {
    file: "app_shop.key.sql",
    sql: `ALTER TABLE app_shop ADD UNIQUE INDEX uk_code (code);
--ALTER TABLE app_shop ADD INDEX idx_commented (label);
ALTER TABLE app_shop ADD INDEX idx_shop_label (label(64));
ALTER TABLE app_shop ADD CONSTRAINT fk_shop_parent  FOREIGN KEY (fk_parent) REFERENCES app_shop (rowid);
ALTER TABLE app_shop ADD CONSTRAINT fk_shop_country FOREIGN KEY (fk_country) REFERENCES app_country (code);
ALTER TABLE app_shop ADD CONSTRAINT fk_shop_user    FOREIGN KEY (fk_user)
    REFERENCES app_user(rowid);`,
  },
  {
    file: "app_shop_user.key.sql",
    sql: `ALTER TABLE app_shop_user ADD PRIMARY KEY pk_shop_user (fk_shop, fk_user);
ALTER TABLE app_shop_user ADD CONSTRAINT fk_su_shop FOREIGN KEY (fk_shop) REFERENCES app_shop (rowid);`,
  },
  {
    file: "app_zone.key.sql",
    sql: "ALTER TABLE app_zone ADD UNIQUE INDEX uk_code (code);\nALTER TABLE app_zone ADD INDEX APP_ZONE (code);",
  },
];

// ── découpe ──────────────────────────────────────────────────────────────
same(
  "un `--` collé ouvre un commentaire, un `--` dans une chaîne n'en ouvre pas",
  splitStatements("--x;\nselect '--a;b' from t; -- fin;\n--y"),
  ["select '--a;b' from t"],
);

const { specs, notes, errors } = convertCorpus(
  { tables: TABLES, keys: KEYS },
  { tablePrefix: "app_" },
);
const byName = Object.fromEntries(specs.map((s) => [s.name, s]));
const shop = byName.app_shop?.columns ?? {};
const noted = (code, table, column) =>
  notes.some(
    (n) =>
      n.code === code &&
      n.table === table &&
      (column === undefined || n.column === column),
  );

same("aucun DDL incompris", errors, []);
same("toutes les tables converties", specs.length, TABLES.length);

// ── genres ───────────────────────────────────────────────────────────────
same("clé auto-incrémentée → serial", shop.rowid, {
  kind: "serial",
  primaryKey: true,
});
same("varchar(n) garde SA longueur", shop.code, {
  kind: "string",
  length: 3,
  notNull: true,
});
same("défaut chaîne : apostrophe doublée et `--` décodés", shop.label, {
  kind: "string",
  length: 128,
  default: "l'été --",
});
same("double(24,8) → decimal(24,8), défaut en chaîne", shop.total_ht, {
  kind: "decimal",
  precision: 24,
  scale: 8,
  default: "0",
});
same("real sans échelle → float", shop.ratio, { kind: "float", default: 0.5 });
rule("…et c'est signalé", noted("float", "app_shop", "ratio"));
same("smallint → int, défaut et NOT NULL gardés", shop.status, {
  kind: "int",
  notNull: true,
  default: 0,
});
same("tinyint de statut → int", shop.flag, { kind: "int", default: 1 });
same("integer unsigned → int64", shop.big_counter, { kind: "int64" });
same("bigint → int64", shop.ext_id, { kind: "int64" });
same("date → jour, défaut littéral", shop.opened, {
  kind: "date",
  default: "2000-01-01",
});
same("boolean DEFAULT 1 → bool true", shop.active, {
  kind: "bool",
  default: true,
});
same("json → json", shop.extra, { kind: "json" });
same("mediumtext → text", shop.note, { kind: "text" });
same("datetime DEFAULT CURRENT_TIMESTAMP → défaut calculé", shop.datec, {
  kind: "datetime",
  defaultFn: "now",
});
same("timestamp ON UPDATE → instant recalculé", shop.tms, {
  kind: "datetime",
  defaultFn: "now",
  onUpdateFn: "now",
});
rule("point : colonne retirée", !("geopoint" in shop));
rule("…et signalée", noted("type-unsupported", "app_shop", "geopoint"));

// ── références ───────────────────────────────────────────────────────────
same("FK vers soi → ref self", shop.fk_parent, { kind: "ref", target: "self" });
same("FK vers une clé → ref, NOT NULL gardé", shop.fk_user, {
  kind: "ref",
  target: "app_user",
  notNull: true,
});
rule(
  "…défaut retiré d'une référence, et signalé",
  noted("ref-default", "app_shop", "fk_user"),
);
same("FK vers une colonne qui n'est pas la clé → valeur", shop.fk_country, {
  kind: "string",
  length: 3,
});
rule("…et signalée", noted("fk-not-key", "app_shop", "fk_country"));

// ── clés ─────────────────────────────────────────────────────────────────
same(
  "clé entière non auto-incrémentée → serial",
  byName.app_country?.columns.rowid,
  {
    kind: "serial",
    primaryKey: true,
  },
);
rule("…et signalée", noted("pk-int-serial", "app_country", "rowid"));
const link = byName.app_shop_user;
same("clé composite → rowid ajoutée", link?.columns.rowid, {
  kind: "serial",
  primaryKey: true,
});
same("…et index unique sur la composite", link?.indexes, [
  { name: "pk_shop_user", on: ["fk_shop", "fk_user"], unique: true },
]);
same("…la colonne de la composite garde sa référence", link?.columns.fk_shop, {
  kind: "ref",
  target: "app_shop",
  notNull: true,
});
rule("…et c'est signalé", noted("pk-composite", "app_shop_user"));
same("table sans clé → rowid ajoutée", byName.app_log?.columns.rowid, {
  kind: "serial",
  primaryKey: true,
});
rule("…et signalée", noted("pk-added", "app_log"));

// ── index ────────────────────────────────────────────────────────────────
same(
  "index : préfixe retiré, ligne commentée ignorée",
  byName.app_shop?.indexes?.map((ix) => ix.name),
  ["uk_code", "idx_shop_label"],
);
rule("…préfixe signalé", noted("index-prefix", "app_shop", "label"));
same(
  "nom d'index déjà porté par une autre table → renommé",
  byName.app_zone?.indexes,
  [
    { name: "uk_code_zone", on: ["code"], unique: true },
    { name: "APP_ZONE_zone", on: ["code"] },
  ],
);
rule("…et signalé", noted("index-renamed", "app_zone"));
// Un index porte le nom d'une TABLE (le sien, à la casse près) : MySQL le
// permet, SQLite et PostgreSQL non — index et tables y partagent un espace de noms.
rule(
  "index homonyme d'une table → signalé comme collision",
  notes.some(
    (n) =>
      n.code === "index-renamed" &&
      /APP_ZONE déjà porté par la table app_zone/u.test(n.detail),
  ),
);

// ── domaines ─────────────────────────────────────────────────────────────
const DOMAINS = {
  fallback: "système",
  rules: [
    ["shop_user", "clients"],
    ["shop", "boutique"],
  ],
};
same(
  "domaine : la PREMIÈRE règle qui correspond gagne",
  domainOf("shop_user", DOMAINS),
  "clients",
);
same("domaine : préfixe plus court", domainOf("shop", DOMAINS), "boutique");
same("domaine : aucune règle → repli", domainOf("zone", DOMAINS), "système");
{
  const withDomains = convertCorpus(
    { tables: TABLES, keys: KEYS },
    { tablePrefix: "app_", domains: DOMAINS },
  );
  const of = (n) => withDomains.specs.find((x) => x.name === n)?.domain;
  same(
    "domaine posé sur la description, préfixe commun retiré avant la règle",
    [of("app_shop_user"), of("app_shop"), of("app_zone")],
    ["clients", "boutique", "système"],
  );
  rule(
    "sans domaines, aucune description n'en porte",
    specs.every((x) => x.domain === undefined),
  );
}

// ── refus ────────────────────────────────────────────────────────────────
const bad = convertCorpus({
  tables: [
    {
      file: "app_bad.sql",
      sql: "create table app_bad ( rowid integer AUTO_INCREMENT PRIMARY KEY, x frobnicate ) ENGINE=innodb;",
    },
    {
      file: "app_worse.sql",
      sql: "create table app_worse ( rowid integer AUTO_INCREMENT PRIMARY KEY, y integer WEIRD ) ENGINE=innodb;",
    },
  ],
  keys: [{ file: "app_bad.key.sql", sql: "ALTER TABLE app_bad DROP INDEX z;" }],
});
same(
  "type inconnu, modificateur inconnu, instruction inconnue : NOMMÉS",
  bad.errors.map((e) => e.split(":")[0]).sort(),
  ["app_bad.key.sql", "app_bad.x", "app_worse.sql"],
);

// ── fixture versionnée erp-lite : le module généré dit-il encore la conversion ? ──
// Le test d'intégration de @nodefony/drizzle lit `specs.ts` sans pouvoir importer
// ce convertisseur (frontière du paquet) : la seule garde contre une dérive
// entre les deux est ICI.
const FIXTURE = path.join(
  findRepoRoot(),
  "src/packages/@nodefony/drizzle/tests/fixtures/erp-lite",
);
const fresh = convertCorpus(readCorpusDir(path.join(FIXTURE, "ddl")), {
  tablePrefix: "erp_",
});
const stored = await import(pathToFileURL(path.join(FIXTURE, "specs.ts")).href);
same("fixture erp-lite : DDL entièrement compris", fresh.errors, []);
same(
  "fixture erp-lite : specs.ts égale la conversion du DDL (sinon régénérer)",
  JSON.parse(JSON.stringify(stored.SPECS)),
  fresh.specs,
);
same(
  "fixture erp-lite : les écarts tranchés aussi",
  JSON.parse(JSON.stringify(stored.NOTES)),
  fresh.notes,
);

if (red.length > 0) {
  console.error(
    `mysql-ddl-to-specs : ${red.length} règle(s) rouge(s), ${green} verte(s)`,
  );
  for (const r of red) console.error(`  ✗ ${r}`);
  process.exit(1);
}
console.log(`mysql-ddl-to-specs : ${green} règles vertes`);
