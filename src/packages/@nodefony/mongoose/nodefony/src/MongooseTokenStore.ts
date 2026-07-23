import { paginate } from "@nodefony/orm-core";
import type { Criteria, IRepository, UpdateData } from "@nodefony/orm-core";
import type { IPage } from "nodefony";
import { assertPageQuery } from "nodefony";
// `import type` UNIQUEMENT (approche B) → effacé à la compilation : aucune
// dépendance runtime de l'ORM vers `@nodefony/security`. L'application câble le
// store via `registerTokenStore("mongoose", …)`.
import type {
  IAccessTokenRecord,
  ITokenListQuery,
  ITokenStore,
  ITokenUsage,
  TokenRevokeReason,
} from "@nodefony/security";
import type { MongooseOrm } from "./orm-core/index";

/** Traduit les filtres de listing en `Criteria` portable (`id`→`_id` géré par le repo). */
function tokenListCriteria(
  query: ITokenListQuery,
): Criteria<IAccessTokenRecord> {
  const criteria: Record<string, unknown> = {};
  if (query.subjectId !== undefined) criteria.subjectId = query.subjectId;
  if (query.kind !== undefined) criteria.kind = query.kind;
  if (query.revoked !== undefined) {
    criteria.revokedAt = { $null: !query.revoked };
  }
  return criteria as Criteria<IAccessTokenRecord>;
}
import {
  TOKEN_ENTITY_NAMES,
  type DeniedJtiRow,
  type SubjectRevocationRow,
} from "../entity/tokenEntity";

/** Fenêtre par défaut de conservation d'un PAT révoqué sans expiration (30 j). */
const DEFAULT_RETENTION_REVOKED_MS = 30 * 24 * 3_600_000;

/**
 * Store de jetons **Mongoose** (NoSQL) — implémentation d'{@link ITokenStore} au
 * dessus de trois repositories `@nodefony/orm-core` (`access_token`, `denied_jti`,
 * `subject_revocation`). Pendant documentaire de `DrizzleTokenStore`.
 *
 * **Approche B** : `@nodefony/security` n'est connu qu'en `import type` (0 dép
 * runtime). C'est l'application qui enregistre la fabrique (`registerTokenStore`)
 * et les entités (`registerTokenEntities(orm)` avant `orm.connect()`).
 *
 * **Spécificité Mongo** : la clé naturelle (`jti` / `subjectId`) est portée par
 * `_id` (cf {@link tokenEntity}). Le contrat traduit `{ id }` → `{ _id }`, donc
 * les lookups passent par le champ `id` ; les **écritures** posent explicitement
 * `_id` (Mongo ne génère pas notre jti). Les reads sont normalisés (`id` ← `_id`)
 * pour ne pas dépendre du virtuel. Le reste est identique au store Drizzle : `gc`
 * via `$lte` (le type bracketing Mongo exclut les `null`), idempotence de `revoke`
 * par read-then-write.
 */
export class MongooseTokenStore implements ITokenStore {
  readonly #records: IRepository<IAccessTokenRecord>;
  readonly #denied: IRepository<DeniedJtiRow>;
  readonly #revocations: IRepository<SubjectRevocationRow>;
  readonly #now: () => number;
  readonly #retentionRevokedMs: number;

  /**
   * @param records - repository de `access_token` (PAT + refresh).
   * @param denied - repository de la denylist `denied_jti`.
   * @param revocations - repository des seuils `subject_revocation`.
   * @param now - horloge (epoch ms) injectable pour les tests.
   * @param retentionRevokedMs - rétention d'un PAT révoqué sans `exp` avant purge.
   */
  constructor(
    records: IRepository<IAccessTokenRecord>,
    denied: IRepository<DeniedJtiRow>,
    revocations: IRepository<SubjectRevocationRow>,
    now: () => number = Date.now,
    retentionRevokedMs: number = DEFAULT_RETENTION_REVOKED_MS,
  ) {
    this.#records = records;
    this.#denied = denied;
    this.#revocations = revocations;
    this.#now = now;
    this.#retentionRevokedMs = retentionRevokedMs;
  }

  /**
   * Construit le store depuis un {@link MongooseOrm} connecté. Les entités
   * (`registerTokenEntities`) doivent avoir été enregistrées **avant** `connect()`.
   *
   * @param orm - ORM Mongoose connecté hébergeant les collections du store.
   * @param now - horloge injectable (tests).
   * @param retentionRevokedMs - rétention des PAT révoqués sans `exp`.
   */
  static from(
    orm: MongooseOrm,
    now?: () => number,
    retentionRevokedMs?: number,
  ): MongooseTokenStore {
    return new MongooseTokenStore(
      orm.getRepository<IAccessTokenRecord>(TOKEN_ENTITY_NAMES.records),
      orm.getRepository<DeniedJtiRow>(TOKEN_ENTITY_NAMES.denied),
      orm.getRepository<SubjectRevocationRow>(TOKEN_ENTITY_NAMES.revocations),
      now,
      retentionRevokedMs,
    );
  }

  /** Identité réelle d'un record (jti) : `_id` fait foi, le virtuel `id` en repli. */
  #idOf(row: IAccessTokenRecord): string {
    return (row as { _id?: string })._id ?? row.id;
  }

  /** Normalise `id` (← `_id`) sur un record lu, sans dépendre du virtuel Mongoose. */
  #withId(row: IAccessTokenRecord | null): IAccessTokenRecord | null {
    if (row) {
      row.id = this.#idOf(row);
    }
    return row;
  }

  // ── Records ────────────────────────────────────────────────────────────────

  /**
   * Insère ou remplace un record (PAT / refresh) — 1 round-trip, `upsert`
   * atomique sur la PK plutôt qu'un `findOne` d'existence + `create`/`updateOne`
   * (dont l'`await` laisse deux put concurrents du même id lire « absent » et
   * insérer tous les deux → E11000 pour le perdant). `put` pose le record
   * COMPLET → tout hors `id` est ré-appliqué au conflit.
   *
   * `id` en critère suffit à poser `_id` : Mongo ajoute les égalités du filtre
   * au document inséré (cf `MongooseRepository.upsert`), plus besoin du `_id`
   * explicite. Parité stricte avec l'adapter Drizzle.
   *
   * @param record - le record complet à persister.
   */
  async put(record: IAccessTokenRecord): Promise<void> {
    const { id, ...rest } = record;
    await this.#records.upsert({ id }, rest as Partial<IAccessTokenRecord>);
  }

  async findById(id: string): Promise<IAccessTokenRecord | null> {
    return this.#withId(await this.#records.findOne({ id }));
  }

  async findByHash(secretHash: string): Promise<IAccessTokenRecord | null> {
    return this.#withId(await this.#records.findOne({ secretHash }));
  }

  async findBySubject(subjectId: string): Promise<IAccessTokenRecord[]> {
    const rows = await this.#records.find({ subjectId });
    for (const row of rows) {
      row.id = this.#idOf(row);
    }
    return rows;
  }

  /** Tous les jetons (PAT + refresh) — vue d'administration cross-porteur. */
  async listAll(): Promise<IAccessTokenRecord[]> {
    const rows = await this.#records.find({});
    for (const row of rows) {
      row.id = this.#idOf(row);
    }
    return rows;
  }

  /**
   * {@inheritDoc ITokenStore.listPage}
   *
   * `paginate()` d'orm-core (skip/limit + countDocuments) sur un filtre portable ;
   * les `id` sont re-normalisés (`_id` → `id`) comme dans {@link listAll}.
   */
  async listPage(query: ITokenListQuery): Promise<IPage<IAccessTokenRecord>> {
    assertPageQuery(query, "offset");
    const page = await paginate(this.#records, {
      criteria: tokenListCriteria(query),
      limit: query.limit,
      offset: query.offset,
      withTotal: query.withTotal,
      order:
        query.order && query.order.length > 0
          ? query.order
          : [
              ["createdAt", "DESC"],
              ["id", "DESC"],
            ],
    });
    for (const row of page.items) {
      row.id = this.#idOf(row);
    }
    return page;
  }

  /** {@inheritDoc ITokenStore.countTokens} */
  countTokens(query: ITokenListQuery): Promise<number> {
    return this.#records.count(tokenListCriteria(query));
  }

  async markUsed(id: string, usage: ITokenUsage): Promise<void> {
    await this.#records.updateOne(
      { id },
      {
        lastUsedAt: usage.at,
        lastUsedIp: usage.ip ?? null,
        lastUsedUserAgent: usage.userAgent ?? null,
      },
    );
  }

  /**
   * Révoque un jeton — **idempotent** : la 1ʳᵉ date/raison est conservée.
   *
   * Le « pas encore révoqué » est dans le filtre (`revokedAt: { $null: true }`),
   * pas dans un `if` JS après lecture : une seule instruction, donc deux
   * révocations concurrentes ne se recouvrent plus (la 2ᵉ ne matche rien au lieu
   * d'écraser la date/raison de la 1ʳᵉ). Parité stricte avec l'adapter Drizzle.
   *
   * @param id - identifiant du jeton.
   * @param reason - motif, posé seulement à la 1ʳᵉ révocation.
   */
  async revoke(id: string, reason: TokenRevokeReason): Promise<void> {
    await this.#records.updateOne(
      { id, revokedAt: { $null: true } },
      { revokedAt: this.#now(), revokedReason: reason },
    );
  }

  /**
   * Coupe toute une famille de refresh (détection de rejeu, RFC 9700) — les
   * membres déjà révoqués gardent leur raison d'origine.
   *
   * Un seul `updateMany` filtré : atomique, et N+1 requêtes (1 find + 1 update
   * par membre actif) tombent à 1.
   *
   * @param family - famille de refresh à couper.
   * @param reason - motif appliqué aux membres encore actifs.
   */
  async revokeFamily(family: string, reason: TokenRevokeReason): Promise<void> {
    await this.#records.updateMany(
      { family, revokedAt: { $null: true } },
      { revokedAt: this.#now(), revokedReason: reason },
    );
  }

  // ── Denylist jti ─────────────────────────────────────────────────────────────

  async denyJti(jti: string, expiresAt: number): Promise<void> {
    // UPSERT atomique sur la PK (cf `put`) : deux dénonciations simultanées du
    // même jeton rejoué ne doivent pas faire remonter d'erreur.
    await this.#denied.upsert({ id: jti }, {
      expiresAt,
    } as Partial<DeniedJtiRow>);
  }

  async isJtiDenied(jti: string): Promise<boolean> {
    const row = await this.#denied.findOne({
      id: jti,
      expiresAt: { $gt: this.#now() },
    });
    return row !== null;
  }

  // ── Révocation en masse par porteur ──────────────────────────────────────────

  /**
   * Pose le seuil de révocation en masse d'un porteur (« déconnecte-moi de
   * partout ») : tout jeton émis avant `invalidBefore` est mort.
   *
   * **Monotone — le seuil ne recule JAMAIS**, y compris sous deux logouts
   * simultanés : la comparaison vit dans la valeur écrite (`$max`, natif Mongo),
   * pas dans un `if` JS après lecture. Une lecture suivie d'une écriture
   * laisserait les deux appels voir le même état et écrire tous les deux — c'est
   * le dernier qui resterait, même porteur d'un seuil plus ANCIEN, et **des
   * jetons révoqués redeviendraient valides**. Parité stricte avec l'adapter
   * Drizzle (`GREATEST`/`MAX` SQL).
   *
   * @param subjectId - porteur visé.
   * @param invalidBefore - seuil (epoch ms) ; ignoré s'il est antérieur au seuil courant.
   */
  async revokeAllForSubject(
    subjectId: string,
    invalidBefore: number,
  ): Promise<void> {
    await this.#revocations.upsert({ id: subjectId }, {
      invalidBefore: { $max: invalidBefore },
    } as UpdateData<SubjectRevocationRow>);
  }

  async getInvalidBefore(subjectId: string): Promise<number | null> {
    const row = await this.#revocations.findOne({ id: subjectId });
    return row ? row.invalidBefore : null;
  }

  // ── Maintenance ──────────────────────────────────────────────────────────────

  async gc(now: number = this.#now()): Promise<number> {
    let purged = 0;
    // 1. Denylist `jti` expirée (type bracketing Mongo : `$lte` ignore les null).
    purged += await this.#denied.delete({ expiresAt: { $lte: now } });
    // 2. Records arrivés à expiration (les `expiresAt` null sont exclus → point 3).
    purged += await this.#records.delete({ expiresAt: { $lte: now } });
    // 3. PAT révoqués SANS expiration au-delà de la rétention. Le `expiresAt`
    //    vide est dans le critère (`$null`) → un seul delete : plus de `find` de
    //    TOUS les révoqués rapatriés en RAM pour un filtre JS (la purge ne dépend
    //    plus du volume purgé).
    purged += await this.#records.delete({
      revokedAt: { $lte: now - this.#retentionRevokedMs },
      expiresAt: { $null: true },
    });
    return purged;
  }
}
