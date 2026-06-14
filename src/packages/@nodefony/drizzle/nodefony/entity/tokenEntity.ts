import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { entityRegistry } from "@nodefony/orm-core";
import type { IEntity } from "@nodefony/orm-core";
// `import type` UNIQUEMENT → effacé à la compilation (approche B : 0 dépendance
// runtime de `@nodefony/drizzle` vers `@nodefony/security`, l'ORM reste pur).
import type {
  IResourcePermission,
  TokenRevokeReason,
} from "@nodefony/security";

/**
 * Tables Drizzle du **store de jetons** `@nodefony/security` (schema-as-code) —
 * implémentation SQL d'`ITokenStore` (PAT, refresh, denylist `jti`, seuil de
 * révocation en masse). Driver `better-sqlite3` ; Postgres/MySQL par simple
 * changement de driver.
 *
 * **Liaison ORM dynamique** (pattern `userTable`, pas `@entity` figé) : en
 * approche B, c'est l'**application** qui câble le store (`registerTokenStore`)
 * ET le connecteur cible (`registerTokenEntities(orm)`) — le module drizzle
 * n'auto-enregistre rien. La table est statique, sa liaison dépend de la config.
 *
 * ⚠️ **Horodatages en epoch ms (`integer` mode number), pas `timestamp_ms`** :
 * `IAccessTokenRecord` porte des `number` (`Date.now()`), pas des `Date` → le
 * `mode` number renvoie bien des nombres. `AccessTokenRow` (forme repository) est
 * **identique** à `IAccessTokenRecord` → zéro mapping store ↔ entité.
 *
 * ⚠️ **Pas de `.default()` SQL** : le DDL dérivé (`getTableConfig`) n'émet ni
 * `DEFAULT` ni index séparés, seulement les contraintes colonne (PK / NOT NULL /
 * UNIQUE). D'où `secretHash` en `.unique()` **colonne** (unicité réelle en dev) ;
 * les `index()` ci-dessous sont lus par `drizzle-kit` (migrations prod) et
 * sans effet sur le DDL dérivé dev/test (perf seule, jamais de sémantique).
 */
export const accessTokenTable = sqliteTable(
  "access_token",
  {
    // ── Identité du record ────────────────────────────────────────────────────
    id: text("id").primaryKey(),
    kind: text("kind").$type<"pat" | "refresh">().notNull(),
    name: text("name").notNull(),
    prefix: text("prefix"),

    // ── Porteur (référence souple, PAS de FK) ─────────────────────────────────
    subjectId: text("subjectId").notNull(),
    subjectType: text("subjectType").$type<"user" | "service">().notNull(),
    tenantId: text("tenantId"),

    // ── Autorisation / portée ─────────────────────────────────────────────────
    scopes: text("scopes", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .$defaultFn(() => []),
    audience: text("audience", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .$defaultFn(() => []),
    resources: text("resources", { mode: "json" }).$type<
      IResourcePermission[]
    >(),

    // ── Secret au repos ───────────────────────────────────────────────────────
    secretHash: text("secretHash").notNull().unique(),
    hashAlg: text("hashAlg").notNull(),

    // ── Provenance / contraintes (slots) ──────────────────────────────────────
    clientId: text("clientId"),
    cnf: text("cnf"),

    // ── Rotation / chaîne (refresh) ───────────────────────────────────────────
    family: text("family"),
    replacedBy: text("replacedBy"),

    // ── Cycle de vie (epoch ms) ───────────────────────────────────────────────
    createdAt: integer("createdAt").notNull(),
    expiresAt: integer("expiresAt"),
    lastUsedAt: integer("lastUsedAt"),
    lastUsedIp: text("lastUsedIp"),
    lastUsedUserAgent: text("lastUsedUserAgent"),
    revokedAt: integer("revokedAt"),
    revokedReason: text("revokedReason").$type<TokenRevokeReason>(),

    // ── Extensibilité ─────────────────────────────────────────────────────────
    metadata: text("metadata", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull()
      .$defaultFn(() => ({})),
  },
  (t) => ({
    subjectIdx: index("access_token_subjectId_idx").on(t.subjectId),
    familyIdx: index("access_token_family_idx").on(t.family),
  }),
);

/**
 * Denylist des access tokens (`jti`) révoqués avant leur `exp` — révocation
 * immédiate ciblée. Purgée par `gc` une fois `expiresAt` (epoch ms) dépassé.
 */
export const deniedJtiTable = sqliteTable("denied_jti", {
  jti: text("jti").primaryKey(),
  expiresAt: integer("expiresAt").notNull(),
});

/** Forme plate d'une ligne de la denylist `jti`. */
export interface DeniedJtiRow {
  jti: string;
  expiresAt: number;
}

/**
 * Seuil de révocation **en masse** par porteur : tout access auto-porté émis
 * avant `invalidBefore` (epoch ms) est rejeté (logout global / ban).
 */
export const subjectRevocationTable = sqliteTable("subject_revocation", {
  subjectId: text("subjectId").primaryKey(),
  invalidBefore: integer("invalidBefore").notNull(),
});

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
 * L'`orm` est **dynamique** (nom du connecteur de l'app, ex. `"default"`) : les
 * tables sont statiques mais leur liaison à un ORM dépend de la config → on ne
 * peut pas les figer via `@entity`. À enregistrer dans `entityRegistry` **avant**
 * `orm.connect()` (cf {@link registerTokenEntities}).
 *
 * @param orm - clé de l'ORM cible dans le `ormRegistry`.
 * @returns les trois descripteurs {@link IEntity} (records / denylist / seuils).
 */
export function createTokenEntities(orm: string): IEntity[] {
  // `module: "security"` → les tables sont regroupées sous @nodefony/security
  // dans l'ERD Studio (le store est une feature security, hébergée par l'ORM).
  return [
    {
      orm,
      name: TOKEN_ENTITY_NAMES.records,
      module: "security",
      schema: accessTokenTable,
    },
    {
      orm,
      name: TOKEN_ENTITY_NAMES.denied,
      module: "security",
      schema: deniedJtiTable,
    },
    {
      orm,
      name: TOKEN_ENTITY_NAMES.revocations,
      module: "security",
      schema: subjectRevocationTable,
    },
  ];
}

/**
 * Enregistre les entités du store de jetons dans le `entityRegistry` pour un ORM
 * donné. À appeler **avant** `orm.connect()` (l'adapter crée les tables au connect).
 *
 * @param orm - clé de l'ORM cible.
 */
export function registerTokenEntities(orm: string): void {
  for (const entity of createTokenEntities(orm)) {
    entityRegistry.register(entity);
  }
}
