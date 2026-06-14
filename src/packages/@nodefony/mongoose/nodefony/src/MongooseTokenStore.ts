import type { IRepository } from "@nodefony/orm-core";
// `import type` UNIQUEMENT (approche B) → effacé à la compilation : aucune
// dépendance runtime de l'ORM vers `@nodefony/security`. L'application câble le
// store via `registerTokenStore("mongoose", …)`.
import type {
  IAccessTokenRecord,
  ITokenStore,
  ITokenUsage,
  TokenRevokeReason,
} from "@nodefony/security";
import type { MongooseOrm } from "./orm-core/index";
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

  async put(record: IAccessTokenRecord): Promise<void> {
    const { id, ...rest } = record;
    const existing = await this.#records.findOne({ id });
    if (existing) {
      await this.#records.updateOne({ id }, rest);
    } else {
      // Mongo ne génère pas notre jti → on pose `_id` explicitement.
      await this.#records.create({
        _id: id,
        ...rest,
      } as Partial<IAccessTokenRecord>);
    }
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

  async revoke(id: string, reason: TokenRevokeReason): Promise<void> {
    // Idempotent + conserve la 1ʳᵉ date/raison (`{ revokedAt: null }` inexploitable).
    const record = await this.#records.findOne({ id });
    if (record && record.revokedAt === null) {
      await this.#records.updateOne(
        { id },
        { revokedAt: this.#now(), revokedReason: reason },
      );
    }
  }

  async revokeFamily(family: string, reason: TokenRevokeReason): Promise<void> {
    const records = await this.#records.find({ family });
    const now = this.#now();
    for (const record of records) {
      if (record.revokedAt === null) {
        await this.#records.updateOne(
          { id: this.#idOf(record) },
          { revokedAt: now, revokedReason: reason },
        );
      }
    }
  }

  // ── Denylist jti ─────────────────────────────────────────────────────────────

  async denyJti(jti: string, expiresAt: number): Promise<void> {
    const existing = await this.#denied.findOne({ id: jti });
    if (existing) {
      await this.#denied.updateOne({ id: jti }, { expiresAt });
    } else {
      await this.#denied.create({
        _id: jti,
        expiresAt,
      } as Partial<DeniedJtiRow>);
    }
  }

  async isJtiDenied(jti: string): Promise<boolean> {
    const row = await this.#denied.findOne({
      id: jti,
      expiresAt: { $gt: this.#now() },
    });
    return row !== null;
  }

  // ── Révocation en masse par porteur ──────────────────────────────────────────

  async revokeAllForSubject(
    subjectId: string,
    invalidBefore: number,
  ): Promise<void> {
    // Monotone : on ne recule jamais le seuil.
    const existing = await this.#revocations.findOne({ id: subjectId });
    if (existing) {
      if (invalidBefore > existing.invalidBefore) {
        await this.#revocations.updateOne({ id: subjectId }, { invalidBefore });
      }
    } else {
      await this.#revocations.create({
        _id: subjectId,
        invalidBefore,
      } as Partial<SubjectRevocationRow>);
    }
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
    // 3. PAT révoqués SANS expiration au-delà de la rétention (filtre JS : le
    //    `expiresAt === null` n'est pas exprimable en critère portable).
    const cutoff = now - this.#retentionRevokedMs;
    const revoked = await this.#records.find({ revokedAt: { $lte: cutoff } });
    const staleIds = revoked
      .filter((record) => record.expiresAt === null)
      .map((record) => this.#idOf(record));
    if (staleIds.length > 0) {
      purged += await this.#records.delete({ id: { $in: staleIds } });
    }
    return purged;
  }
}
