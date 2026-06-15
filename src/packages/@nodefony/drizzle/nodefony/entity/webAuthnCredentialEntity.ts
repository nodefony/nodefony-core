import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { entityRegistry } from "@nodefony/orm-core";
import type { IEntity } from "@nodefony/orm-core";

/**
 * Table Drizzle du **store de credentials WebAuthn** `@nodefony/security`
 * (schema-as-code) — implémentation SQL d'`IWebAuthnCredentialStore` (passkeys).
 * Driver `better-sqlite3` ; Postgres/MySQL par simple changement de driver.
 *
 * **Liaison ORM dynamique** (pattern `userTable`/`tokenEntity`, pas `@entity`
 * figé) : en approche B, c'est l'**application** qui câble le store
 * (`registerWebAuthnStore`) ET le connecteur cible
 * (`registerWebAuthnCredentialEntity(orm)` avant `orm.connect()`) — le module
 * drizzle n'auto-enregistre rien.
 *
 * ⚠️ **Horodatages en epoch ms (`integer` mode number), pas `timestamp_ms`** :
 * `IWebAuthnCredential` porte des `number` (`Date.now()`), pas des `Date`.
 *
 * ⚠️ **Pas de `.default()` SQL** : le DDL dérivé (`getTableConfig`) n'émet ni
 * `DEFAULT` ni index séparés. Le store fournit TOUJOURS toutes les colonnes
 * `notNull` au `save` ; `transports` garde un `$defaultFn` JS en filet. L'`index`
 * `userId` est lu par `drizzle-kit` (prod) et sans effet sur le DDL dev/test.
 *
 * Le store ne lit/écrit JAMAIS `IWebAuthnCredential` directement : il traduit via
 * {@link WebAuthnCredentialRow} (forme plate SQL, `nickname: string | null`) — le
 * contrat porte un `nickname?` optionnel et des champs `readonly`, que la
 * frontière de persistance normalise (≠ `tokenEntity`, tout `| null`).
 */
export const webAuthnCredentialTable = sqliteTable(
  "webauthn_credential",
  {
    /** Identifiant du credential (base64url) — clé fournie par l'authenticator. */
    id: text("id").primaryKey(),
    /** Propriétaire (sub / userHandle applicatif). */
    userId: text("userId").notNull(),
    /** Clé publique COSE encodée base64url. */
    publicKey: text("publicKey").notNull(),
    /** Compteur de signatures (anti-clone, §6.1.1). */
    signCount: integer("signCount").notNull(),
    /** Transports annoncés (`usb`|`nfc`|`ble`|`internal`|`hybrid`). */
    transports: text("transports", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .$defaultFn(() => []),
    /** BE flag (Backup Eligibility) — fixé à l'enregistrement. */
    backupEligible: integer("backupEligible", { mode: "boolean" }).notNull(),
    /** BS flag (Backup State) — peut évoluer. */
    backupState: integer("backupState", { mode: "boolean" }).notNull(),
    /** UV réalisée au moins une fois (base du step-up MFA). */
    uvInitialized: integer("uvInitialized", { mode: "boolean" }).notNull(),
    /** Surnom choisi par l'utilisateur ; `null` = aucun. */
    nickname: text("nickname"),
    /** Création (epoch ms). */
    createdAt: integer("createdAt").notNull(),
    /** Dernière authentification réussie (epoch ms) ou `null`. */
    lastUsedAt: integer("lastUsedAt"),
  },
  (t) => ({
    userIdx: index("webauthn_credential_userId_idx").on(t.userId),
  }),
);

/**
 * Forme **plate** d'une ligne de credentials renvoyée par le repository ORM —
 * `nickname: string | null` (≠ `nickname?: string` du contrat) et `transports`
 * mutable. `DrizzleWebAuthnCredentialStore` mappe `Row ↔ IWebAuthnCredential`.
 */
export interface WebAuthnCredentialRow {
  id: string;
  userId: string;
  publicKey: string;
  signCount: number;
  transports: string[];
  backupEligible: boolean;
  backupState: boolean;
  uvInitialized: boolean;
  nickname: string | null;
  createdAt: number;
  lastUsedAt: number | null;
}

/** Nom logique de l'entité (clé de lookup `getRepository`). */
export const WEBAUTHN_CREDENTIAL_ENTITY = "webauthn_credential";

/**
 * Construit le descripteur d'entité du store de credentials pour un ORM nommé.
 *
 * L'`orm` est **dynamique** (nom du connecteur de l'app, ex. `"default"`) : la
 * table est statique mais sa liaison à un ORM dépend de la config → pas d'`@entity`
 * figé. À enregistrer **avant** `orm.connect()` (cf {@link registerWebAuthnCredentialEntity}).
 *
 * `module: "security"` → la table est regroupée sous @nodefony/security dans l'ERD
 * Studio (le store est une feature security, hébergée par l'ORM de l'app).
 *
 * @param orm - clé de l'ORM cible dans le `ormRegistry`.
 */
export function createWebAuthnCredentialEntity(orm: string): IEntity {
  return {
    orm,
    name: WEBAUTHN_CREDENTIAL_ENTITY,
    module: "security",
    schema: webAuthnCredentialTable,
  };
}

/**
 * Enregistre l'entité du store de credentials dans le `entityRegistry` pour un
 * ORM donné. À appeler **avant** `orm.connect()` (l'adapter crée la table au connect).
 *
 * @param orm - clé de l'ORM cible.
 */
export function registerWebAuthnCredentialEntity(orm: string): void {
  entityRegistry.register(createWebAuthnCredentialEntity(orm));
}
