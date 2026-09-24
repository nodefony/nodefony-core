import {
  paginate,
  searchCriteria,
  type Criteria,
  type IRepository,
} from "@nodefony/orm-core";
import type { IPage } from "nodefony";
import { assertPageQuery } from "nodefony";
// `import type` UNIQUEMENT (approche B) → effacé à la compilation : aucune
// dépendance runtime de l'ORM vers `@nodefony/security`. C'est l'auto-register
// du module (`registerStores.ts`) qui câble `registerTotpStore("mongoose", …)`.
import type {
  ITotpEnrollmentSummary,
  ITotpListQuery,
  ITotpSecret,
  ITotpSecretStore,
  TotpSecretUpdate,
} from "@nodefony/security";
import type { MongooseOrm } from "./orm-core/index";
import {
  TOTP_SECRET_ENTITY,
  type TotpSecretRow,
} from "../entity/totpSecretEntity";

/**
 * Store de secrets TOTP **Mongoose** (NoSQL) — implémentation documentaire d'
 * {@link ITotpSecretStore} au-dessus d'un unique repository `@nodefony/orm-core`
 * (`totp_secret`). Pendant documentaire de `DrizzleTotpSecretStore` : là où
 * `MemoryTotpSecretStore` est volatile, ce store survit au redémarrage et se
 * partage entre pods.
 *
 * **Modèle 1 secret / utilisateur** (clé = `userId`, portée par `_id`) → `save`
 * est un upsert par clé primaire.
 *
 * **Approche B** : `@nodefony/security` n'est connu qu'en `import type` (0 dép
 * runtime).  L'entité (`registerTotpSecretEntity`) doit être enregistrée
 * **avant** `orm.connect()` (le modèle est compilé au connect).
 *
 * **100 % portable** (aucune query native) — toutes les opérations passent par
 * le contrat `IRepository`, comme son frère SQL : l'`userId` est cherché sous
 * `id` (le contrat traduit `{ id }` → `{ _id }`), et le listing par `paginate()`.
 *
 * **`secretEnc` opaque** : le store persiste le secret DÉJÀ chiffré (AES-256-GCM
 * côté service) — il ne déchiffre jamais, ne voit que des octets. Il ne sort
 * JAMAIS par `listPage` (cf {@link ITotpEnrollmentSummary}).
 */
export class MongooseTotpSecretStore implements ITotpSecretStore {
  readonly #repo: IRepository<TotpSecretRow>;

  /**
   * @param repo - repository de la collection `totp_secret`.
   */
  constructor(repo: IRepository<TotpSecretRow>) {
    this.#repo = repo;
  }

  /** Connecteur ORM qui porte ce store — posé par {@link MongooseTotpSecretStore.from}. */
  #connector: string | undefined;

  /**
   * Connecteur ORM qui porte ce store, lu par `readStoreConnector` pour le
   * registre des stores : la console rattache la brique à SON connecteur au
   * lieu de le déduire. `undefined` pour un store construit sans ORM (bancs).
   */
  get connector(): string | undefined {
    return this.#connector;
  }

  /**
   * Construit le store depuis un {@link MongooseOrm} connecté. L'entité
   * (`registerTotpSecretEntity`) doit avoir été enregistrée **avant**
   * `orm.connect()`.
   *
   * @param orm - ORM Mongoose connecté hébergeant la collection du store.
   */
  static from(orm: MongooseOrm): MongooseTotpSecretStore {
    const store = new MongooseTotpSecretStore(
      orm.getRepository<TotpSecretRow>(TOTP_SECRET_ENTITY),
    );
    store.#connector = orm.name;
    return store;
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

  async findByUser(userId: string): Promise<ITotpSecret | null> {
    // `id` → `_id` par le contrat du repository : la clé naturelle EST la PK.
    const row = await this.#repo.findOne({ id: userId });
    return row ? this.#toSecret(row) : null;
  }

  async save(secret: ITotpSecret): Promise<void> {
    // UPSERT atomique sur la PK : 1 round-trip, pas de `findOne` d'existence
    // (dont l'`await` laisse deux enrôlements concurrents du même utilisateur
    // voir « non enrôlé » → deux insert → E11000 pour le perdant). `id` en
    // critère suffit à poser `_id` (Mongo ajoute les égalités du filtre au
    // document inséré) ; `userId` est réécrit dans le document car c'est LUI
    // que le vocabulaire public trie et filtre. `save` pose le secret COMPLET
    // (ré-enrôlement) → tout est ré-appliqué au conflit.
    await this.#repo.upsert(
      { id: secret.userId },
      {
        userId: secret.userId,
        secretEnc: secret.secretEnc,
        algorithm: secret.algorithm,
        digits: secret.digits,
        period: secret.period,
        recoveryCodes: [...secret.recoveryCodes],
        confirmedAt: secret.confirmedAt,
        lastUsedStep: secret.lastUsedStep,
        createdAt: secret.createdAt,
        lastUsedAt: secret.lastUsedAt,
      },
    );
  }

  async update(userId: string, patch: TotpSecretUpdate): Promise<void> {
    // Patch PARTIEL : ne toucher QUE les champs présents (comme le store
    // mémoire) — sinon un champ omis serait écrasé à `null`. Rien à écrire = no-op.
    const set: Partial<TotpSecretRow> = {};
    if (patch.confirmedAt !== undefined) set.confirmedAt = patch.confirmedAt;
    if (patch.recoveryCodes !== undefined)
      set.recoveryCodes = [...patch.recoveryCodes];
    if (patch.lastUsedStep !== undefined) set.lastUsedStep = patch.lastUsedStep;
    if (patch.lastUsedAt !== undefined) set.lastUsedAt = patch.lastUsedAt;
    if (Object.keys(set).length === 0) {
      return;
    }
    // updateOne est un no-op (renvoie null) si l'utilisateur est inconnu → conforme.
    await this.#repo.updateOne({ id: userId }, set);
  }

  async delete(userId: string): Promise<void> {
    await this.#repo.delete({ id: userId });
  }

  /**
   * Critère portable des filtres du listing. `confirmed` s'exprime en `$null`
   * sur `confirmedAt` (pas de champ booléen dérivé à maintenir), `q` en `$like`
   * **ancré à gauche** (`préfixe%`) — traduit en `$regex` ancré par le
   * repository, donc servable par un index.
   */
  #listCriteria(query: ITotpListQuery): Criteria<TotpSecretRow> {
    const criteria: Record<string, unknown> = {};
    if (query.confirmed !== undefined) {
      criteria.confirmedAt = { $null: !query.confirmed };
    }
    // La règle de recherche (échappement du terme + motif ancré à gauche) vit
    // au socle, en un exemplaire — la recopier ici la ferait diverger du frère SQL.
    Object.assign(
      criteria,
      searchCriteria<TotpSecretRow>(query.q, ["userId"]) ?? {},
    );
    return criteria as unknown as Criteria<TotpSecretRow>;
  }

  /**
   * {@inheritDoc ITotpSecretStore.listPage}
   *
   * 100 % portable : le helper `paginate()` d'orm-core (limite/décalage + total
   * optionnel) sur un critère simple. La projection en vue d'enrôlement retire
   * `secretEnc` et les condensats — ils ne franchissent jamais la frontière du
   * store, quel que soit l'appelant.
   */
  async listPage(
    query: ITotpListQuery,
  ): Promise<IPage<ITotpEnrollmentSummary>> {
    assertPageQuery(query, "offset");
    const page = await paginate(this.#repo, {
      criteria: this.#listCriteria(query),
      limit: query.limit,
      offset: query.offset,
      withTotal: query.withTotal,
      order: [
        ["createdAt", "DESC"],
        ["userId", "ASC"], // tiebreaker → décalage déterministe
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
