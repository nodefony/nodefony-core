import type { IRepository } from "@nodefony/orm-core";
// `import type` UNIQUEMENT (approche B) → effacé à la compilation : aucune
// dépendance runtime de l'ORM vers `@nodefony/security`. L'application câble le
// store via `registerWebAuthnStore("drizzle", …)` ; le module drizzle reste pur.
import type {
  IWebAuthnCredential,
  IWebAuthnCredentialStore,
  WebAuthnAuthUpdate,
} from "@nodefony/security";
import type { DrizzleOrm } from "./orm-core/DrizzleOrm";
import {
  WEBAUTHN_CREDENTIAL_ENTITY,
  type WebAuthnCredentialRow,
} from "../entity/webAuthnCredentialEntity";

/**
 * Store de credentials WebAuthn **Drizzle** (driver `better-sqlite3`) —
 * implémentation SQL d'{@link IWebAuthnCredentialStore} au-dessus d'un unique
 * repository `@nodefony/orm-core` (`webauthn_credential`).
 *
 * **Approche B** : l'ORM ne connaît `@nodefony/security` qu'en `import type` → 0
 * dépendance runtime. C'est l'application qui enregistre la fabrique
 * (`registerWebAuthnStore("drizzle", …)`) et l'entité
 * (`registerWebAuthnCredentialEntity(orm)` avant `orm.connect()`).
 *
 * **100 % portable** (aucun SQL natif) — toutes les opérations passent par le
 * contrat `IRepository`, donc le code se transpose tel quel aux autres drivers.
 *
 * **Mapping Row ↔ contrat** : le repository renvoie une {@link WebAuthnCredentialRow}
 * plate (`nickname: string | null`, `transports` mutable) ; le store la normalise
 * en `IWebAuthnCredential` (`nickname?` omis si `null`). Le store de jetons n'a pas
 * ce mapping car `IAccessTokenRecord` est déjà la forme repository (tout `| null`).
 */
export class DrizzleWebAuthnCredentialStore implements IWebAuthnCredentialStore {
  readonly #repo: IRepository<WebAuthnCredentialRow>;
  readonly #location: string | undefined;

  /**
   * @param repo - repository de la table `webauthn_credential`.
   * @param location - emplacement physique de la base (fichier SQLite) pour Studio
   *   ({@link DrizzleOrm.location}) ; `undefined` pour un backend réseau/`:memory:`.
   */
  constructor(repo: IRepository<WebAuthnCredentialRow>, location?: string) {
    this.#repo = repo;
    this.#location = location;
  }

  /**
   * Emplacement physique de la base (fichier SQLite) pour l'écran Studio « Stores »
   * — lu par `readStoreLocation`. `undefined` = backend réseau ou `:memory:`.
   */
  get location(): string | undefined {
    return this.#location;
  }

  /**
   * Construit le store depuis un {@link DrizzleOrm} connecté. L'entité
   * (`registerWebAuthnCredentialEntity`) doit avoir été enregistrée **avant**
   * `orm.connect()`.
   *
   * @param orm - ORM Drizzle connecté hébergeant la table du store.
   */
  static from(orm: DrizzleOrm): DrizzleWebAuthnCredentialStore {
    return new DrizzleWebAuthnCredentialStore(
      orm.getRepository<WebAuthnCredentialRow>(WEBAUTHN_CREDENTIAL_ENTITY),
      orm.location,
    );
  }

  /** Row plate → credential du contrat (`nickname?` omis si `null`). */
  #toCredential(row: WebAuthnCredentialRow): IWebAuthnCredential {
    return {
      id: row.id,
      userId: row.userId,
      publicKey: row.publicKey,
      signCount: row.signCount,
      transports: row.transports,
      backupEligible: row.backupEligible,
      backupState: row.backupState,
      uvInitialized: row.uvInitialized,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
      ...(row.nickname !== null ? { nickname: row.nickname } : {}),
    };
  }

  /** Credential du contrat → row plate (`nickname` absent → `null`, transports copié). */
  #toRow(c: IWebAuthnCredential): WebAuthnCredentialRow {
    return {
      id: c.id,
      userId: c.userId,
      publicKey: c.publicKey,
      signCount: c.signCount,
      transports: [...c.transports],
      backupEligible: c.backupEligible,
      backupState: c.backupState,
      uvInitialized: c.uvInitialized,
      nickname: c.nickname ?? null,
      createdAt: c.createdAt,
      lastUsedAt: c.lastUsedAt,
    };
  }

  async findById(credentialId: string): Promise<IWebAuthnCredential | null> {
    const row = await this.#repo.findOne({ id: credentialId });
    return row ? this.#toCredential(row) : null;
  }

  async findByUser(userId: string): Promise<IWebAuthnCredential[]> {
    const rows = await this.#repo.find({ userId });
    return rows.map((row) => this.#toCredential(row));
  }

  async save(credential: IWebAuthnCredential): Promise<void> {
    // UPSERT atomique sur la PK `id` : 1 requête, pas de `findOne` d'existence
    // (dont l'`await` laisse deux enregistrements concurrents de la même
    // passkey voir « absent » → deux INSERT → le perdant lève « UNIQUE
    // constraint failed »). `save` pose le credential COMPLET → tout le reste
    // est ré-appliqué au conflit.
    const { id, ...rest } = this.#toRow(credential);
    await this.#repo.upsert({ id }, rest as Partial<WebAuthnCredentialRow>);
  }

  async update(credentialId: string, patch: WebAuthnAuthUpdate): Promise<void> {
    // updateOne est un no-op (renvoie null) si l'id est inconnu → conforme au contrat.
    await this.#repo.updateOne(
      { id: credentialId },
      {
        signCount: patch.signCount,
        backupState: patch.backupState,
        uvInitialized: patch.uvInitialized,
        lastUsedAt: patch.lastUsedAt,
      },
    );
  }

  async delete(credentialId: string): Promise<void> {
    await this.#repo.delete({ id: credentialId });
  }
}
