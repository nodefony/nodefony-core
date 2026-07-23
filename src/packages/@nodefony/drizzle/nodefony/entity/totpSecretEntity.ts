import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { entityRegistry } from "@nodefony/orm-core";
import type { IEntity } from "@nodefony/orm-core";
import type { SqlDialect } from "../interfaces/IDrizzleConfig";
import {
  createFrameworkTableFactory,
  type IFrameworkTableSpec,
} from "./colKit";

/**
 * Algorithme HMAC du code TOTP (RFC 6238) — union littérale (miroir du
 * `TotpAlgorithm` de `@nodefony/security`, non ré-exporté à la racine). Écrite en
 * clair plutôt que dérivée d'`ITotpSecret["algorithm"]` : sinon le `.d.ts` généré
 * référencerait un chemin interne du package security (non portable, TS2883).
 */
type TotpAlgorithm = "SHA1" | "SHA256" | "SHA512";

/**
 * Entité du **store de secrets TOTP** `@nodefony/security` (2FA) — implémentation
 * SQL d'`ITotpSecretStore`, déclinée via le `colKit` (S2 multi-dialecte) : une
 * spec logique, la table du dialecte du connecteur.
 *
 * **Modèle 1 secret / utilisateur** → clé primaire = `userId` (pas d'id de ligne
 * séparé, `save` est un upsert par `userId`). Pas d'index secondaire : tout accès
 * passe par la PK.
 *
 * ⚠️ **`secretEnc` = secret déjà CHIFFRÉ** (AES-256-GCM par le service détenteur de
 * la clé) : le store ne voit que des octets opaques, jamais le secret `K` en clair.
 *
 * ⚠️ **`lastUsedStep` = tranche `T` RFC 6238 (kind `int`)**, pas un horodatage —
 * les vrais horodatages (`confirmedAt`/`createdAt`/`lastUsedAt`) sont en `epochMs`.
 *
 * ⚠️ **Pas de `.default()` SQL** (règle colKit) : le store fournit TOUJOURS toutes
 * les colonnes `notNull` au `save` ; `recoveryCodes` garde un `defaultFn` JS en filet.
 */
const TOTP_SECRET_TABLE_SPEC = {
  name: "totp_secret",
  columns: {
    /** Propriétaire du secret (clé naturelle — un seul secret par utilisateur). */
    userId: { kind: "text", primaryKey: true },
    /** Secret partagé `K` **chiffré** (blob opaque `iv.tag.ciphertext` base64url). */
    secretEnc: { kind: "text", notNull: true },
    /** Fonction HMAC du code (`SHA1`|`SHA256`|`SHA512`). */
    algorithm: { kind: "text", notNull: true },
    /** Nombre de chiffres du code. */
    digits: { kind: "int", notNull: true },
    /** Période d'un code en secondes. */
    period: { kind: "int", notNull: true },
    /** Condensats `sha256` des codes de récupération non encore consommés. */
    recoveryCodes: { kind: "json", notNull: true, defaultFn: () => [] },
    /** Confirmation de l'enrôlement (epoch ms) ou `null` (anti-lock-out). */
    confirmedAt: { kind: "epochMs" },
    /** Dernière tranche `T` validée (RFC 6238 §5.2, anti-rejeu) ou `null`. */
    lastUsedStep: { kind: "int" },
    /** Création (epoch ms). */
    createdAt: { kind: "epochMs", notNull: true },
    /** Dernier usage réussi (epoch ms) ou `null`. */
    lastUsedAt: { kind: "epochMs" },
  },
} satisfies IFrameworkTableSpec;

/**
 * Factory de la table de secrets TOTP pour un dialecte donné (mémoïsée — une
 * instance par dialecte). **Les trois dialectes sont portés** (`TOTP_PORTED =
 * ALL_DIALECTS`, `registerStores.ts:92`) : sqlite, postgres et mysql.
 */
export const createTotpSecretTable = createFrameworkTableFactory(
  TOTP_SECRET_TABLE_SPEC,
);

/**
 * Variante SQLite de la table de secrets TOTP (dialecte par défaut) — export
 * conservé pour l'usage direct/banc-test.
 */
export const totpSecretTable: SQLiteTable = createTotpSecretTable("sqlite");

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
 * Le `connector` est **dynamique** (nom du connecteur de l'app) et la variante de table
 * suit le dialecte du connecteur (auto-register `registerStores.ts`). À enregistrer
 * **avant** `orm.connect()`. `module: "security"` → regroupé sous @nodefony/security
 * dans l'ERD Studio.
 *
 * @param orm - clé de l'ORM cible dans le `ormRegistry`.
 * @param dialect - dialecte SQL du connecteur (sélectionne la variante de table).
 */
export function createTotpSecretEntity(
  connector: string,
  dialect: SqlDialect = "sqlite",
): IEntity {
  return {
    connector,
    name: TOTP_SECRET_ENTITY,
    module: "security",
    schema: createTotpSecretTable(dialect),
  };
}

/**
 * Enregistre l'entité du store de secrets TOTP dans le `entityRegistry` pour un ORM
 * donné. À appeler **avant** `orm.connect()` (l'adapter crée la table au connect).
 *
 * @param connector - nom de la connexion cible (clé du registre).
 * @param dialect - dialecte SQL du connecteur (variante de table — défaut `sqlite`).
 */
export function registerTotpSecretEntity(
  connector: string,
  dialect: SqlDialect = "sqlite",
): void {
  entityRegistry.register(createTotpSecretEntity(connector, dialect));
}
