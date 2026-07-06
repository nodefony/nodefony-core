import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { entityRegistry } from "@nodefony/orm-core";
import type { IEntity } from "@nodefony/orm-core";
import type { SqlDialect } from "../interfaces/IDrizzleConfig";
import {
  createFrameworkTableFactory,
  type IFrameworkTableSpec,
} from "./colKit";

/**
 * Entités du **store de jetons** `@nodefony/security` (schema-as-code) —
 * implémentation SQL d'`ITokenStore` (PAT, refresh, denylist `jti`, seuil de
 * révocation en masse), déclinées via le `colKit` (S2 multi-dialecte) : une
 * spec logique par table, la variante du dialecte du connecteur.
 *
 * ⚠️ **Horodatages en epoch ms (kind `epochMs`, exposés `number`)** :
 * `IAccessTokenRecord` porte des `number` (`Date.now()`), pas des `Date` →
 * `AccessTokenRow` (forme repository) est **identique** à `IAccessTokenRecord`
 * → zéro mapping store ↔ entité.
 *
 * ⚠️ **Pas de `.default()` SQL** (règle colKit) : le DDL dérivé n'émet ni
 * `DEFAULT` ni index séparés, seulement les contraintes colonne (PK / NOT NULL /
 * UNIQUE). D'où `secretHash` en `unique` **colonne** (unicité réelle en dev) ;
 * les index déclarés sont lus par `drizzle-kit` (migrations prod) et sans effet
 * sur le DDL dérivé dev/test (perf seule, jamais de sémantique).
 *
 * Les unions du contrat (`kind`, `subjectType`, `revokedReason`,
 * `IResourcePermission[]`) vivent sur les types `Row`/`IAccessTokenRecord`
 * (frontière typée), plus sur les colonnes — décision S1 : les types publics
 * des entités framework sont leurs interfaces `Row`, pas l'inférence Drizzle.
 */
const ACCESS_TOKEN_TABLE_SPEC = {
  name: "access_token",
  columns: {
    // ── Identité du record ──────────────────────────────────────────────────
    id: { kind: "text", primaryKey: true },
    kind: { kind: "text", notNull: true },
    name: { kind: "text", notNull: true },
    prefix: { kind: "text" },

    // ── Porteur (référence souple, PAS de FK) ───────────────────────────────
    subjectId: { kind: "text", notNull: true },
    subjectType: { kind: "text", notNull: true },
    tenantId: { kind: "text" },

    // ── Autorisation / portée ───────────────────────────────────────────────
    scopes: { kind: "json", notNull: true, defaultFn: () => [] },
    audience: { kind: "json", notNull: true, defaultFn: () => [] },
    resources: { kind: "json" },

    // ── Secret au repos ─────────────────────────────────────────────────────
    secretHash: { kind: "text", notNull: true, unique: true },
    hashAlg: { kind: "text", notNull: true },

    // ── Provenance / contraintes (slots) ────────────────────────────────────
    clientId: { kind: "text" },
    cnf: { kind: "text" },

    // ── Rotation / chaîne (refresh) ─────────────────────────────────────────
    family: { kind: "text" },
    replacedBy: { kind: "text" },

    // ── Cycle de vie (epoch ms) ─────────────────────────────────────────────
    createdAt: { kind: "epochMs", notNull: true },
    expiresAt: { kind: "epochMs" },
    lastUsedAt: { kind: "epochMs" },
    lastUsedIp: { kind: "text" },
    lastUsedUserAgent: { kind: "text" },
    revokedAt: { kind: "epochMs" },
    revokedReason: { kind: "text" },

    // ── Extensibilité ───────────────────────────────────────────────────────
    metadata: { kind: "json", notNull: true, defaultFn: () => ({}) },
  },
  indexes: [
    { name: "access_token_subjectId_idx", on: ["subjectId"] },
    { name: "access_token_family_idx", on: ["family"] },
  ],
} satisfies IFrameworkTableSpec;

/**
 * Denylist des access tokens (`jti`) révoqués avant leur `exp` — révocation
 * immédiate ciblée. Purgée par `gc` une fois `expiresAt` (epoch ms) dépassé.
 */
const DENIED_JTI_TABLE_SPEC = {
  name: "denied_jti",
  columns: {
    jti: { kind: "text", primaryKey: true },
    expiresAt: { kind: "epochMs", notNull: true },
  },
} satisfies IFrameworkTableSpec;

/**
 * Seuil de révocation **en masse** par porteur : tout access auto-porté émis
 * avant `invalidBefore` (epoch ms) est rejeté (logout global / ban).
 */
const SUBJECT_REVOCATION_TABLE_SPEC = {
  name: "subject_revocation",
  columns: {
    subjectId: { kind: "text", primaryKey: true },
    invalidBefore: { kind: "epochMs", notNull: true },
  },
} satisfies IFrameworkTableSpec;

/** Factory de la table des records (mémoïsée — une instance par dialecte). */
export const createAccessTokenTable = createFrameworkTableFactory(
  ACCESS_TOKEN_TABLE_SPEC,
);

/** Factory de la denylist `jti` (mémoïsée — une instance par dialecte). */
export const createDeniedJtiTable = createFrameworkTableFactory(
  DENIED_JTI_TABLE_SPEC,
);

/** Factory des seuils de révocation (mémoïsée — une instance par dialecte). */
export const createSubjectRevocationTable = createFrameworkTableFactory(
  SUBJECT_REVOCATION_TABLE_SPEC,
);

/**
 * Variantes SQLite des trois tables (dialecte par défaut) — exports conservés
 * pour l'usage direct/banc-test.
 */
export const accessTokenTable: SQLiteTable = createAccessTokenTable("sqlite");
export const deniedJtiTable: SQLiteTable = createDeniedJtiTable("sqlite");
export const subjectRevocationTable: SQLiteTable =
  createSubjectRevocationTable("sqlite");

/** Forme plate d'une ligne de la denylist `jti`. */
export interface DeniedJtiRow {
  jti: string;
  expiresAt: number;
}

/** Forme plate d'une ligne de révocation par porteur. */
export interface SubjectRevocationRow {
  subjectId: string;
  invalidBefore: number;
}

/** Noms logiques des entités du store (clés de lookup `getRepository`). */
export const TOKEN_ENTITY_NAMES = {
  records: "access_token",
  denied: "denied_jti",
  revocations: "subject_revocation",
} as const;

/**
 * Construit les descripteurs d'entités du store de jetons pour un ORM nommé.
 *
 * L'`orm` est **dynamique** (nom du connecteur de l'app, ex. `"default"`) et la
 * variante de table suit le dialecte du connecteur (auto-register
 * `registerStores.ts` à `onKernelRegister`). À enregistrer dans `entityRegistry`
 * **avant** `orm.connect()` (cf {@link registerTokenEntities}).
 *
 * @param orm - clé de l'ORM cible dans le `ormRegistry`.
 * @param dialect - dialecte SQL du connecteur (sélectionne la variante des tables).
 * @returns les trois descripteurs {@link IEntity} (records / denylist / seuils).
 */
export function createTokenEntities(
  orm: string,
  dialect: SqlDialect = "sqlite",
): IEntity[] {
  // `module: "security"` → les tables sont regroupées sous @nodefony/security
  // dans l'ERD Studio (le store est une feature security, hébergée par l'ORM).
  return [
    {
      orm,
      name: TOKEN_ENTITY_NAMES.records,
      module: "security",
      schema: createAccessTokenTable(dialect),
    },
    {
      orm,
      name: TOKEN_ENTITY_NAMES.denied,
      module: "security",
      schema: createDeniedJtiTable(dialect),
    },
    {
      orm,
      name: TOKEN_ENTITY_NAMES.revocations,
      module: "security",
      schema: createSubjectRevocationTable(dialect),
    },
  ];
}

/**
 * Enregistre les entités du store de jetons dans le `entityRegistry` pour un ORM
 * donné. À appeler **avant** `orm.connect()` (l'adapter crée les tables au connect).
 *
 * @param orm - clé de l'ORM cible.
 * @param dialect - dialecte SQL du connecteur (variante des tables — défaut `sqlite`).
 */
export function registerTokenEntities(
  orm: string,
  dialect: SqlDialect = "sqlite",
): void {
  for (const entity of createTokenEntities(orm, dialect)) {
    entityRegistry.register(entity);
  }
}
