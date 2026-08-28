import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";
import type { SqlDialect } from "../../nodefony/interfaces/IDrizzleConfig";
import { registerSessionEntity } from "../../nodefony/entity/sessionEntity";
import { registerTokenEntities } from "../../nodefony/entity/tokenEntity";
import { registerIdempotencyEntities } from "../../nodefony/entity/idempotencyEntity";
import { registerUserEntity } from "../../nodefony/entity/userTable";
import { registerAuditEntities } from "../../nodefony/entity/auditEventEntity";
import { registerTotpSecretEntity } from "../../nodefony/entity/totpSecretEntity";
import { registerWebAuthnCredentialEntity } from "../../nodefony/entity/webAuthnCredentialEntity";
import { registerWebhookEndpointEntity } from "../../nodefony/entity/webhookEndpointEntity";

/**
 * BANC DE PARITÉ **migrations ↔ DDL dérivé** — la seule preuve que développement
 * et production construisent la MÊME base.
 *
 * **Pourquoi il existe.** Deux chemins créent le schéma du framework, et ils
 * n'ont aucun code commun : en développement, l'adapter dérive un
 * `CREATE TABLE IF NOT EXISTS` depuis les tables Drizzle (`DrizzleOrm`) ; en
 * production, on applique un fichier de migration produit par `drizzle-kit`
 * depuis les mêmes entités. Rien ne garantit qu'ils convergent — et une
 * divergence ne se voit pas : l'application démarre, les requêtes passent, et
 * c'est une colonne manquante ou un type trop étroit qui se manifeste des mois
 * plus tard, en production seulement.
 *
 * **Ce que « parité » veut dire ici, précisément** — trois écarts de FORME sont
 * attendus et n'ont aucune conséquence, les confondre avec un vrai écart rendrait
 * ce banc inutilisable :
 *
 * 1. **Les noms d'index diffèrent.** Une contrainte `UNIQUE` déclarée sur une
 *    colonne devient un index nommé (`…_secretHash_unique`) dans la migration, et
 *    un auto-index anonyme (`sqlite_autoindex_…`) dans le DDL dérivé. La
 *    comparaison porte donc sur les **colonnes couvertes**, jamais sur le nom.
 * 2. **L'ordre des colonnes** n'est pas garanti identique — on compare des
 *    ensembles indexés par nom.
 * 3. **Les types s'écrivent parfois différemment** pour la même chose selon le
 *    chemin (`INTEGER` / `integer`) : la comparaison normalise la casse.
 *
 * Tout le reste — la liste des tables, la liste des colonnes, leur type, leur
 * nullabilité, la clé primaire, les jeux de colonnes uniques, les index — doit
 * être **strictement identique**.
 */

const MODULE_ROOT = path.resolve(
  fileURLToPath(import.meta.url),
  "..",
  "..",
  "..",
);

/** Marqueur de format attendu en tête de chaque fichier de migration. */
const FORMAT_MARKER = "-- nodefony:migration format=1";

/**
 * Les dix tables du schéma du framework, dans l'ordre alphabétique.
 *
 * Écrite ici plutôt que déduite : sur MySQL, la base est PARTAGÉE avec les autres
 * suites (l'utilisateur applicatif ne peut pas en créer une), donc le banc doit
 * savoir exactement ce qu'il a le droit d'effacer et d'observer. Une liste
 * déduite du registre suivrait n'importe quelle erreur d'enregistrement.
 */
export const FRAMEWORK_TABLES = [
  "access_token",
  "audit_event",
  "denied_jti",
  "idempotency_key",
  "session",
  "subject_revocation",
  "totp_secret",
  "User",
  "webauthn_credential",
  "webhook_endpoint",
] as const;

/** Une colonne, telle qu'observée dans une base réelle. */
export interface IObservedColumn {
  name: string;
  type: string;
  notNull: boolean;
  primaryKey: boolean;
}

/** Un index, réduit à ce qui a un sens : unicité et colonnes couvertes. */
export interface IObservedIndex {
  unique: boolean;
  columns: string[];
}

/** L'état observable d'une base, indépendant du chemin qui l'a construite. */
export interface IObservedSchema {
  tables: string[];
  columns: Record<string, Record<string, IObservedColumn>>;
  indexes: Record<string, IObservedIndex[]>;
}

/** Exécute une requête et rend les lignes — une par dialecte. */
export type QueryFn = (sql: string) => Record<string, unknown>[];

/**
 * Lit les instructions d'un fichier de migration, marqueur de format vérifié.
 *
 * Le marqueur n'est pas décoratif : c'est la porte de sortie prévue pour changer
 * d'outil un jour. Un format inconnu doit être un REFUS, jamais une lecture « au
 * mieux » qui appliquerait des instructions mal découpées.
 *
 * @param dialect - dialecte dont on lit la migration initiale.
 * @returns les instructions, dans l'ordre du fichier.
 * @throws AssertionError si le marqueur manque.
 */
export function readInitialMigration(dialect: SqlDialect): string[] {
  const file = path.join(
    MODULE_ROOT,
    "migrations",
    dialect,
    "0000_framework_init.sql",
  );
  const body = fs.readFileSync(file, "utf8");
  assert.ok(
    body.startsWith(FORMAT_MARKER),
    `${dialect}/0000_framework_init.sql ne porte pas « ${FORMAT_MARKER} » : ` +
      `un applicateur ne doit PAS deviner le format d'un fichier qu'il exécute.`,
  );
  return body
    .slice(FORMAT_MARKER.length)
    .split("--> statement-breakpoint")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);
}

/** Normalise un type natif : la casse seule ne fait pas une différence. */
const normalizeType = (type: string): string =>
  type.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Range les index par table sous une forme comparable (sans les noms).
 *
 * @param entries - index observés, avec leur table.
 * @returns les index par table, triés — deux bases équivalentes rendent la même
 *   structure quel que soit l'ordre de lecture.
 */
export function groupIndexes(
  entries: Array<{ table: string; unique: boolean; columns: string[] }>,
): Record<string, IObservedIndex[]> {
  const out: Record<string, IObservedIndex[]> = {};
  for (const entry of entries) {
    (out[entry.table] ??= []).push({
      unique: entry.unique,
      columns: [...entry.columns],
    });
  }
  for (const table of Object.keys(out)) {
    out[table].sort((a, b) =>
      `${a.unique}|${a.columns.join(",")}`.localeCompare(
        `${b.unique}|${b.columns.join(",")}`,
      ),
    );
  }
  return out;
}

/**
 * Compare deux bases et échoue en NOMMANT l'écart — jamais un `deepEqual` nu.
 *
 * Un `deepEqual` sur deux schémas entiers rend un pavé illisible où il faut
 * chercher la ligne qui diffère ; celui qui lit l'échec doit savoir en une phrase
 * quelle table, quelle colonne, et quel chemin s'écarte de l'autre.
 *
 * @param migrated - base construite en appliquant la migration.
 * @param derived - base construite par le DDL dérivé de l'adapter.
 * @param dialect - dialecte, cité dans les messages.
 */
export function assertSchemasMatch(
  migrated: IObservedSchema,
  derived: IObservedSchema,
  dialect: SqlDialect,
): void {
  const only = (a: string[], b: string[]): string[] =>
    a.filter((x) => !b.includes(x));

  const missing = only(derived.tables, migrated.tables);
  const extra = only(migrated.tables, derived.tables);
  assert.deepEqual(
    { missing, extra },
    { missing: [], extra: [] },
    `[${dialect}] tables : « missing » manque à la base MIGRÉE (la migration ne ` +
      `les crée pas) ; « extra » manque à la base DÉRIVÉE (la migration crée ` +
      `des tables que le développement n'a pas).`,
  );

  for (const table of derived.tables) {
    const mCols = migrated.columns[table] ?? {};
    const dCols = derived.columns[table] ?? {};
    const mNames = Object.keys(mCols).sort();
    const dNames = Object.keys(dCols).sort();
    assert.deepEqual(
      { missing: only(dNames, mNames), extra: only(mNames, dNames) },
      { missing: [], extra: [] },
      `[${dialect}] colonnes de « ${table} » : « missing » absente de la base ` +
        `MIGRÉE, « extra » absente de la base DÉRIVÉE.`,
    );

    for (const name of dNames) {
      const m = mCols[name];
      const d = dCols[name];
      assert.equal(
        normalizeType(m.type),
        normalizeType(d.type),
        `[${dialect}] ${table}.${name} : type « ${m.type} » après migration, ` +
          `« ${d.type} » en développement — les deux chemins ne construisent ` +
          `pas la même colonne.`,
      );
      assert.equal(
        m.notNull,
        d.notNull,
        `[${dialect}] ${table}.${name} : nullabilité divergente ` +
          `(migré notNull=${m.notNull}, dérivé notNull=${d.notNull}).`,
      );
      assert.equal(
        m.primaryKey,
        d.primaryKey,
        `[${dialect}] ${table}.${name} : appartenance à la clé primaire ` +
          `divergente (migré=${m.primaryKey}, dérivé=${d.primaryKey}).`,
      );
    }

    const key = (list: IObservedIndex[]): string[] =>
      list.map(
        (i) => `${i.unique ? "UNIQUE" : "INDEX"}(${i.columns.join(",")})`,
      );
    const mIdx = key(migrated.indexes[table] ?? []);
    const dIdx = key(derived.indexes[table] ?? []);
    assert.deepEqual(
      { missing: only(dIdx, mIdx), extra: only(mIdx, dIdx) },
      { missing: [], extra: [] },
      `[${dialect}] index de « ${table} » — comparés par COLONNES COUVERTES, ` +
        `jamais par nom : « missing » absent après migration, « extra » absent ` +
        `en développement.`,
    );
  }
}

/** Les huit enregistreurs d'entités du framework, dans l'ordre du schéma. */
const REGISTRARS = [
  registerSessionEntity,
  registerTokenEntities,
  registerIdempotencyEntities,
  registerUserEntity,
  registerAuditEntities,
  registerTotpSecretEntity,
  registerWebAuthnCredentialEntity,
  registerWebhookEndpointEntity,
] as const;

/**
 * Monte une base par le DDL dérivé : les dix entités du framework, puis
 * `connect()` — exactement ce que fait une application en développement.
 *
 * @param connector - clé d'ORM, propre au test (le registre est global).
 * @param dialect - dialecte monté.
 * @param connection - options de connexion de l'adapter.
 * @returns l'ORM connecté, à libérer par l'appelant.
 */
export async function buildDerivedDatabase(
  connector: string,
  dialect: SqlDialect,
  connection: { filename?: string; url?: string },
): Promise<DrizzleOrm> {
  for (const register of REGISTRARS) {
    register(connector, dialect);
  }
  const orm = new DrizzleOrm(connector, { dialect, ...connection });
  await orm.connect();
  return orm;
}

/**
 * Libère l'ORM et VIDE le registre global des entités du connecteur.
 *
 * Sans ce nettoyage, une suite voisine qui enregistre la même entité sur le même
 * connecteur échouerait sur un doublon — et l'échec pointerait la suite
 * innocente.
 *
 * @param orm - ORM à déconnecter.
 * @param connector - connecteur à purger des registres.
 */
export async function releaseDerivedDatabase(
  orm: DrizzleOrm,
  connector: string,
): Promise<void> {
  await orm.disconnect();
  // Pas d'appel optionnel ici : si `list()` disparaissait, le nettoyage ne
  // ferait plus rien EN SILENCE, et l'échec tomberait sur une suite voisine.
  for (const entity of entityRegistry.list()) {
    if (entity.connector === connector) {
      entityRegistry.unregister(entity.name, connector);
    }
  }
  ormRegistry.unregister(connector);
}
