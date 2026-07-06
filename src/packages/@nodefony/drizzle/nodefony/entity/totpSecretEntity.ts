import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { entityRegistry } from "@nodefony/orm-core";
import type { IEntity } from "@nodefony/orm-core";

/**
 * Algorithme HMAC du code TOTP (RFC 6238) — union littérale (miroir du
 * `TotpAlgorithm` de `@nodefony/security`, non ré-exporté à la racine). Écrite en
 * clair plutôt que dérivée d'`ITotpSecret["algorithm"]` : sinon le `.d.ts` généré
 * référencerait un chemin interne du package security (non portable, TS2883).
 */
type TotpAlgorithm = "SHA1" | "SHA256" | "SHA512";

/**
 * Table Drizzle du **store de secrets TOTP** `@nodefony/security` (schema-as-code)
 * — implémentation SQL d'`ITotpSecretStore` (2FA). Driver `better-sqlite3` ;
 * Postgres/MySQL par simple changement de driver.
 *
 * **Modèle 1 secret / utilisateur** → clé primaire = `userId` (pas d'id de ligne
 * séparé, `save` est un upsert par `userId`). Pas d'index secondaire : tout accès
 * passe par la PK.
 *
 * **Liaison ORM dynamique** (pattern `webAuthnCredentialEntity`/`tokenEntity`, pas
 * `@entity` figé) : l'auto-register du module (`registerDrizzleFrameworkStores`)
 * câble entité + fabrique ; l'app peut poser les siennes AVANT (guards idempotents).
 *
 * ⚠️ **`secretEnc` = secret déjà CHIFFRÉ** (AES-256-GCM par le service détenteur de
 * la clé) : le store ne voit que des octets opaques, jamais le secret `K` en clair.
 *
 * ⚠️ **Horodatages en epoch ms (`integer` mode number), pas `timestamp_ms`** :
 * `ITotpSecret` porte des `number` (`Date.now()`), pas des `Date`.
 *
 * ⚠️ **Pas de `.default()` SQL** : le DDL dérivé (`getTableConfig`) n'émet pas de
 * `DEFAULT` — le store fournit TOUJOURS toutes les colonnes `notNull` au `save` ;
 * `recoveryCodes` garde un `$defaultFn` JS en filet.
 */
export const totpSecretTable = sqliteTable("totp_secret", {
  /** Propriétaire du secret (clé naturelle — un seul secret par utilisateur). */
  userId: text("userId").primaryKey(),
  /** Secret partagé `K` **chiffré** (blob opaque `iv.tag.ciphertext` base64url). */
  secretEnc: text("secretEnc").notNull(),
  /** Fonction HMAC du code (`SHA1`|`SHA256`|`SHA512`). */
  algorithm: text("algorithm").$type<TotpAlgorithm>().notNull(),
  /** Nombre de chiffres du code. */
  digits: integer("digits").notNull(),
  /** Période d'un code en secondes. */
  period: integer("period").notNull(),
  /** Condensats `sha256` des codes de récupération non encore consommés. */
  recoveryCodes: text("recoveryCodes", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .$defaultFn(() => []),
  /** Confirmation de l'enrôlement (epoch ms) ou `null` (anti-lock-out). */
  confirmedAt: integer("confirmedAt"),
  /** Dernière tranche `T` validée (RFC 6238 §5.2, anti-rejeu) ou `null`. */
  lastUsedStep: integer("lastUsedStep"),
  /** Création (epoch ms). */
  createdAt: integer("createdAt").notNull(),
  /** Dernier usage réussi (epoch ms) ou `null`. */
  lastUsedAt: integer("lastUsedAt"),
});

/**
 * Forme **plate** d'une ligne de secret renvoyée par le repository ORM. Structure
 * identique à `ITotpSecret` (tout `| null` déjà présent côté contrat) → mapping
 * quasi-identité dans `DrizzleTotpSecretStore` (≠ `webAuthnCredentialEntity` qui a
 * un `nickname?` à normaliser).
 */
export interface TotpSecretRow {
  userId: string;
  secretEnc: string;
  algorithm: TotpAlgorithm;
  digits: number;
  period: number;
  recoveryCodes: string[];
  confirmedAt: number | null;
  lastUsedStep: number | null;
  createdAt: number;
  lastUsedAt: number | null;
}

/** Nom logique de l'entité (clé de lookup `getRepository`). */
export const TOTP_SECRET_ENTITY = "totp_secret";

/**
 * Construit le descripteur d'entité du store de secrets TOTP pour un ORM nommé.
 * L'`orm` est **dynamique** (nom du connecteur de l'app) : la table est statique
 * mais sa liaison à un ORM dépend de la config → pas d'`@entity` figé. À enregistrer
 * **avant** `orm.connect()`. `module: "security"` → regroupé sous @nodefony/security
 * dans l'ERD Studio.
 *
 * @param orm - clé de l'ORM cible dans le `ormRegistry`.
 */
export function createTotpSecretEntity(orm: string): IEntity {
  return {
    orm,
    name: TOTP_SECRET_ENTITY,
    module: "security",
    schema: totpSecretTable,
  };
}

/**
 * Enregistre l'entité du store de secrets TOTP dans le `entityRegistry` pour un ORM
 * donné. À appeler **avant** `orm.connect()` (l'adapter crée la table au connect).
 *
 * @param orm - clé de l'ORM cible.
 */
export function registerTotpSecretEntity(orm: string): void {
  entityRegistry.register(createTotpSecretEntity(orm));
}
