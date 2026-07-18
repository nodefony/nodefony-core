import { paginate, type Criteria, type IRepository } from "@nodefony/orm-core";
import type { IPage } from "nodefony";
// `import type` UNIQUEMENT (approche B) → effacé à la compilation : aucune
// dépendance runtime de l'ORM vers `@nodefony/security`. L'application (ou
// l'auto-register du module) câble le store via `registerTotpStore("drizzle", …)`.
import type {
  ITotpEnrollmentSummary,
  ITotpListQuery,
  ITotpSecret,
  ITotpSecretStore,
  TotpSecretUpdate,
} from "@nodefony/security";
import type { DrizzleOrm } from "./orm-core/DrizzleOrm";
import {
  TOTP_SECRET_ENTITY,
  type TotpSecretRow,
} from "../entity/totpSecretEntity";

/**
 * Store de secrets TOTP **Drizzle** (driver `better-sqlite3`) — implémentation SQL
 * d'{@link ITotpSecretStore} au-dessus d'un unique repository `@nodefony/orm-core`
 * (`totp_secret`). Comble le gap « 2FA persistant sans fichier » : là où
 * `MemoryTotpSecretStore` est volatile, ce store survit au redémarrage et se
 * partage entre pods (base durable).
 *
 * **Modèle 1 secret / utilisateur** (clé = `userId`) → `save` est un upsert par PK.
 *
 * **Approche B** : l'ORM ne connaît `@nodefony/security` qu'en `import type` → 0
 * dépendance runtime. L'entité (`registerTotpSecretEntity(orm)`) doit être
 * enregistrée **avant** `orm.connect()`.
 *
 * **100 % portable** (aucun SQL natif) — toutes les opérations passent par le
 * contrat `IRepository`, donc le code se transpose tel quel aux autres drivers.
 *
 * **`secretEnc` opaque** : le store persiste le secret DÉJÀ chiffré (AES-256-GCM
 * côté service) — il ne déchiffre jamais, ne voit que des octets.
 */
export class DrizzleTotpSecretStore implements ITotpSecretStore {
  readonly #repo: IRepository<TotpSecretRow>;
  readonly #location: string | undefined;

  /**
   * @param repo - repository de la table `totp_secret`.
   * @param location - emplacement physique de la base (fichier SQLite) pour Studio
   *   ({@link DrizzleOrm.location}) ; `undefined` pour un backend réseau/`:memory:`.
   */
  constructor(repo: IRepository<TotpSecretRow>, location?: string) {
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
   * (`registerTotpSecretEntity`) doit avoir été enregistrée **avant** `orm.connect()`.
   *
   * @param orm - ORM Drizzle connecté hébergeant la table du store.
   */
  static from(orm: DrizzleOrm): DrizzleTotpSecretStore {
    return new DrizzleTotpSecretStore(
      orm.getRepository<TotpSecretRow>(TOTP_SECRET_ENTITY),
      orm.location,
    );
  }

  /** Row plate → secret du contrat (recoveryCodes copié = mutable indépendant). */
  #toSecret(row: TotpSecretRow): ITotpSecret {
    return {
      userId: row.userId,
      secretEnc: row.secretEnc,
      algorithm: row.algorithm,
      digits: row.digits,
      period: row.period,
      recoveryCodes: [...row.recoveryCodes],
      confirmedAt: row.confirmedAt,
      lastUsedStep: row.lastUsedStep,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
    };
  }

  /** Secret du contrat → row plate (colonnes `notNull` toutes fournies). */
  #toRow(s: ITotpSecret): TotpSecretRow {
    return {
      userId: s.userId,
      secretEnc: s.secretEnc,
      algorithm: s.algorithm,
      digits: s.digits,
      period: s.period,
      recoveryCodes: [...s.recoveryCodes],
      confirmedAt: s.confirmedAt,
      lastUsedStep: s.lastUsedStep,
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
    };
  }

  async findByUser(userId: string): Promise<ITotpSecret | null> {
    const row = await this.#repo.findOne({ userId });
    return row ? this.#toSecret(row) : null;
  }

  async save(secret: ITotpSecret): Promise<void> {
    // UPSERT atomique sur la PK `userId` : 1 requête, pas de `findOne`
    // d'existence (dont l'`await` laisse deux enrôlements concurrents du même
    // user voir « non enrôlé » → deux INSERT → le perdant lève « UNIQUE
    // constraint failed »). `save` pose le secret COMPLET (ré-enrôlement) →
    // tout le reste est ré-appliqué au conflit.
    const { userId, ...rest } = this.#toRow(secret);
    await this.#repo.upsert({ userId }, rest as Partial<TotpSecretRow>);
  }

  async update(userId: string, patch: TotpSecretUpdate): Promise<void> {
    // Patch PARTIEL : ne toucher QUE les colonnes présentes (comme le store
    // mémoire) — sinon un champ omis serait écrasé à NULL. Rien à écrire = no-op.
    const set: Partial<TotpSecretRow> = {};
    if (patch.confirmedAt !== undefined) set.confirmedAt = patch.confirmedAt;
    if (patch.recoveryCodes !== undefined)
      set.recoveryCodes = patch.recoveryCodes;
    if (patch.lastUsedStep !== undefined) set.lastUsedStep = patch.lastUsedStep;
    if (patch.lastUsedAt !== undefined) set.lastUsedAt = patch.lastUsedAt;
    if (Object.keys(set).length === 0) {
      return;
    }
    // updateOne est un no-op (renvoie null) si `userId` est inconnu → conforme.
    await this.#repo.updateOne({ userId }, set);
  }

  async delete(userId: string): Promise<void> {
    await this.#repo.delete({ userId });
  }

  /**
   * Critère portable des filtres du listing. `confirmed` s'exprime en `$null`
   * sur `confirmedAt` (pas de colonne booléenne dérivée à maintenir), `q` en
   * `$like` **ancré à gauche** (`préfixe%`) — donc indexable, contrairement à
   * une recherche `%…%`.
   */
  #listCriteria(query: ITotpListQuery): Criteria<TotpSecretRow> {
    const criteria: Record<string, unknown> = {};
    if (query.confirmed !== undefined) {
      criteria.confirmedAt = { $null: !query.confirmed };
    }
    if (query.q !== undefined && query.q.length > 0) {
      // `%`/`_` du terme saisi sont échappés : un id collé n'est pas un motif.
      criteria.userId = {
        $like: `${query.q.replace(/[\\%_]/g, (c) => "\\" + c)}%`,
      };
    }
    return criteria as unknown as Criteria<TotpSecretRow>;
  }

  /**
   * {@inheritDoc ITotpSecretStore.listPage}
   *
   * 100 % portable : le helper `paginate()` d'orm-core (LIMIT/OFFSET + COUNT
   * optionnel) sur un critère simple. La projection en vue d'enrôlement retire
   * `secretEnc` et les condensats — ils ne franchissent jamais la frontière du
   * store, quel que soit l'appelant.
   */
  async listPage(
    query: ITotpListQuery,
  ): Promise<IPage<ITotpEnrollmentSummary>> {
    const page = await paginate(this.#repo, {
      criteria: this.#listCriteria(query),
      limit: query.limit,
      offset: query.offset,
      withTotal: query.withTotal,
      order: [
        ["createdAt", "DESC"],
        ["userId", "ASC"], // tiebreaker → offset déterministe
      ],
    });
    return {
      ...page,
      items: page.items.map((row) => ({
        userId: row.userId,
        algorithm: row.algorithm,
        digits: row.digits,
        period: row.period,
        confirmedAt: row.confirmedAt,
        createdAt: row.createdAt,
        lastUsedAt: row.lastUsedAt,
        recoveryCodesLeft: row.recoveryCodes.length,
      })),
    };
  }

  /** {@inheritDoc ITotpSecretStore.countEnrollments} */
  countEnrollments(query: ITotpListQuery): Promise<number> {
    return this.#repo.count(this.#listCriteria(query));
  }
}
