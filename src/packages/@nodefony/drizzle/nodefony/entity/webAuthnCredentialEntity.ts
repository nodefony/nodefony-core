import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { entityRegistry } from "@nodefony/orm-core";
import type { IEntity } from "@nodefony/orm-core";
import type { SqlDialect } from "../interfaces/IDrizzleConfig";
import {
  createFrameworkTableFactory,
  type IFrameworkTableSpec,
} from "./colKit";

/**
 * Entité du **store de credentials WebAuthn** `@nodefony/security` (passkeys) —
 * implémentation SQL d'`IWebAuthnCredentialStore`, déclinée via le `colKit`
 * (S2 multi-dialecte) : une spec logique, la table du dialecte du connecteur.
 *
 * ⚠️ **Horodatages en epoch ms (kind `epochMs`, exposés `number`)** :
 * `IWebAuthnCredential` porte des `number` (`Date.now()`), pas des `Date`.
 *
 * ⚠️ **Pas de `.default()` SQL** (règle colKit) : le DDL dérivé n'émet ni
 * `DEFAULT` ni index séparés. Le store fournit TOUJOURS toutes les colonnes
 * `notNull` au `save` ; `transports` garde un `defaultFn` JS en filet. L'index
 * `userId` est lu par `drizzle-kit` (prod), sans effet sur le DDL dev/test.
 *
 * Le store ne lit/écrit JAMAIS `IWebAuthnCredential` directement : il traduit via
 * {@link WebAuthnCredentialRow} (forme plate SQL, `nickname: string | null`) — le
 * contrat porte un `nickname?` optionnel et des champs `readonly`, que la
 * frontière de persistance normalise (≠ `tokenEntity`, tout `| null`).
 */
const WEBAUTHN_CREDENTIAL_TABLE_SPEC = {
  name: "webauthn_credential",
  columns: {
    /** Identifiant du credential (base64url) — clé fournie par l'authenticator. */
    id: { kind: "text", primaryKey: true },
    /** Propriétaire (sub / userHandle applicatif). */
    userId: { kind: "text", notNull: true },
    /** Clé publique COSE encodée base64url. */
    publicKey: { kind: "text", notNull: true },
    /** Compteur de signatures (anti-clone, §6.1.1). */
    signCount: { kind: "int", notNull: true },
    /** Transports annoncés (`usb`|`nfc`|`ble`|`internal`|`hybrid`). */
    transports: { kind: "json", notNull: true, defaultFn: () => [] },
    /** BE flag (Backup Eligibility) — fixé à l'enregistrement. */
    backupEligible: { kind: "bool", notNull: true },
    /** BS flag (Backup State) — peut évoluer. */
    backupState: { kind: "bool", notNull: true },
    /** UV réalisée au moins une fois (base du step-up MFA). */
    uvInitialized: { kind: "bool", notNull: true },
    /** Surnom choisi par l'utilisateur ; `null` = aucun. */
    nickname: { kind: "text" },
    /** Création (epoch ms). */
    createdAt: { kind: "epochMs", notNull: true },
    /** Dernière authentification réussie (epoch ms) ou `null`. */
    lastUsedAt: { kind: "epochMs" },
  },
  indexes: [{ name: "webauthn_credential_userId_idx", on: ["userId"] }],
} satisfies IFrameworkTableSpec;

/**
 * Factory de la table de credentials pour un dialecte donné (mémoïsée — une
 * instance par dialecte). `sqlite` (défaut) et `postgres` sont portés ;
 * `mysql` jette (S4).
 */
export const createWebAuthnCredentialTable = createFrameworkTableFactory(
  WEBAUTHN_CREDENTIAL_TABLE_SPEC,
);

/**
 * Variante SQLite de la table de credentials (dialecte par défaut) — export
 * conservé pour l'usage direct/banc-test.
 */
export const webAuthnCredentialTable: SQLiteTable =
  createWebAuthnCredentialTable("sqlite");

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
 * L'`orm` est **dynamique** (nom du connecteur de l'app, ex. `"default"`) et la
 * variante de table suit le dialecte du connecteur (auto-register
 * `registerStores.ts` à `onKernelRegister`). À enregistrer **avant**
 * `orm.connect()` (cf {@link registerWebAuthnCredentialEntity}).
 *
 * `module: "security"` → la table est regroupée sous @nodefony/security dans l'ERD
 * Studio (le store est une feature security, hébergée par l'ORM de l'app).
 *
 * @param orm - clé de l'ORM cible dans le `ormRegistry`.
 * @param dialect - dialecte SQL du connecteur (sélectionne la variante de table).
 */
export function createWebAuthnCredentialEntity(
  orm: string,
  dialect: SqlDialect = "sqlite",
): IEntity {
  return {
    orm,
    name: WEBAUTHN_CREDENTIAL_ENTITY,
    module: "security",
    schema: createWebAuthnCredentialTable(dialect),
  };
}

/**
 * Enregistre l'entité du store de credentials dans le `entityRegistry` pour un
 * ORM donné. À appeler **avant** `orm.connect()` (l'adapter crée la table au connect).
 *
 * @param orm - clé de l'ORM cible.
 * @param dialect - dialecte SQL du connecteur (variante de table — défaut `sqlite`).
 */
export function registerWebAuthnCredentialEntity(
  orm: string,
  dialect: SqlDialect = "sqlite",
): void {
  entityRegistry.register(createWebAuthnCredentialEntity(orm, dialect));
}
