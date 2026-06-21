import type { IRepository } from "@nodefony/orm-core";
// `import type` UNIQUEMENT (approche B) → effacé à la compilation : aucune
// dépendance runtime de l'ORM vers `@nodefony/security`. L'application câble le
// store via `registerTokenStore("drizzle", …)` ; le module drizzle reste pur.
import type {
  IAccessTokenRecord,
  ITokenStore,
  ITokenUsage,
  TokenRevokeReason,
} from "@nodefony/security";
import type { DrizzleOrm } from "./orm-core/DrizzleOrm";
import {
  TOKEN_ENTITY_NAMES,
  type DeniedJtiRow,
  type SubjectRevocationRow,
} from "../entity/tokenEntity";

/** Fenêtre par défaut de conservation d'un PAT révoqué sans expiration (30 j). */
const DEFAULT_RETENTION_REVOKED_MS = 30 * 24 * 3_600_000;

/**
 * Store de jetons **Drizzle** (driver `better-sqlite3`) — implémentation SQL
 * d'{@link ITokenStore} au-dessus de trois repositories `@nodefony/orm-core`
 * (`access_token`, `denied_jti`, `subject_revocation`).
 *
 * **Approche B** (validée 2026-06-14) : l'ORM ne connaît `@nodefony/security`
 * qu'en `import type` → 0 dépendance runtime. C'est l'application qui enregistre
 * la fabrique (`registerTokenStore("drizzle", ({ container }) =>
 * DrizzleTokenStore.from(container.get("…orm…")))`) et les entités
 * (`registerTokenEntities(orm)` avant `orm.connect()`).
 *
 * **100 % portable** (aucun SQL natif) — toutes les opérations passent par le
 * contrat `IRepository`, donc le code se transpose tel quel aux autres drivers.
 * Deux contraintes du critère portable sont contournées **sans** descendre au
 * natif :
 *  - `IS NULL` n'est pas exprimable (`eq(col, null)` = toujours faux en SQL) →
 *    l'idempotence de {@link DrizzleTokenStore.revoke} (ne pas écraser la 1ʳᵉ
 *    date/raison de révocation) se fait par **read-then-write** côté JS ;
 *  - la purge des PAT révoqués **sans expiration** ({@link DrizzleTokenStore.gc})
 *    se fait par `find({ revokedAt: { $lte } })` + filtre JS `expiresAt === null`
 *    + `delete({ id: { $in } })` — jamais un `WHERE expiresAt IS NULL`.
 *
 * Horloge injectable (`now`) pour des tests déterministes.
 */
export class DrizzleTokenStore implements ITokenStore {
  readonly #records: IRepository<IAccessTokenRecord>;
  readonly #denied: IRepository<DeniedJtiRow>;
  readonly #revocations: IRepository<SubjectRevocationRow>;
  readonly #now: () => number;
  readonly #retentionRevokedMs: number;

  /**
   * @param records - repository de la table `access_token` (PAT + refresh).
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
   * Construit le store depuis un {@link DrizzleOrm} connecté. Les entités
   * (`registerTokenEntities`) doivent avoir été enregistrées **avant**
   * `orm.connect()`.
   *
   * @param orm - ORM Drizzle connecté hébergeant les tables du store.
   * @param now - horloge injectable (tests).
   * @param retentionRevokedMs - rétention des PAT révoqués sans `exp`.
   */
  static from(
    orm: DrizzleOrm,
    now?: () => number,
    retentionRevokedMs?: number,
  ): DrizzleTokenStore {
    return new DrizzleTokenStore(
      orm.getRepository<IAccessTokenRecord>(TOKEN_ENTITY_NAMES.records),
      orm.getRepository<DeniedJtiRow>(TOKEN_ENTITY_NAMES.denied),
      orm.getRepository<SubjectRevocationRow>(TOKEN_ENTITY_NAMES.revocations),
      now,
      retentionRevokedMs,
    );
  }

  // ── Records ────────────────────────────────────────────────────────────────

  async put(record: IAccessTokenRecord): Promise<void> {
    const existing = await this.#records.findOne({ id: record.id });
    if (existing) {
      await this.#records.updateOne({ id: record.id }, record);
    } else {
      await this.#records.create(record);
    }
  }

  findById(id: string): Promise<IAccessTokenRecord | null> {
    return this.#records.findOne({ id });
  }

  findByHash(secretHash: string): Promise<IAccessTokenRecord | null> {
    return this.#records.findOne({ secretHash });
  }

  findBySubject(subjectId: string): Promise<IAccessTokenRecord[]> {
    return this.#records.find({ subjectId });
  }

  /** Tous les jetons (PAT + refresh) — vue d'administration cross-porteur. */
  listAll(): Promise<IAccessTokenRecord[]> {
    return this.#records.find({});
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
    // Idempotent + conserve la 1ʳᵉ date/raison : on ne touche que si non révoqué.
    // (`{ revokedAt: null }` en critère est inexploitable — `eq(col, null)` faux.)
    const record = await this.#records.findOne({ id });
    if (record && record.revokedAt === null) {
      await this.#records.updateOne(
        { id },
        { revokedAt: this.#now(), revokedReason: reason },
      );
    }
  }

  async revokeFamily(family: string, reason: TokenRevokeReason): Promise<void> {
    // Coupe toute la famille (détection de rejeu, RFC 9700) ; les membres déjà
    // révoqués (ex. `rotated`) gardent leur raison d'origine.
    const records = await this.#records.find({ family });
    const now = this.#now();
    for (const record of records) {
      if (record.revokedAt === null) {
        await this.#records.updateOne(
          { id: record.id },
          { revokedAt: now, revokedReason: reason },
        );
      }
    }
  }

  // ── Denylist jti ─────────────────────────────────────────────────────────────

  async denyJti(jti: string, expiresAt: number): Promise<void> {
    const existing = await this.#denied.findOne({ jti });
    if (existing) {
      await this.#denied.updateOne({ jti }, { expiresAt });
    } else {
      await this.#denied.create({ jti, expiresAt });
    }
  }

  async isJtiDenied(jti: string): Promise<boolean> {
    // Une entrée expirée ne matche pas (`$gt now`) → false sans lazy-delete (le
    // GC s'en charge ; éviter une écriture sur un chemin de lecture).
    const row = await this.#denied.findOne({
      jti,
      expiresAt: { $gt: this.#now() },
    });
    return row !== null;
  }

  // ── Révocation en masse par porteur ──────────────────────────────────────────

  async revokeAllForSubject(
    subjectId: string,
    invalidBefore: number,
  ): Promise<void> {
    // Monotone : on ne recule jamais le seuil (deux logouts successifs).
    const existing = await this.#revocations.findOne({ subjectId });
    if (existing) {
      if (invalidBefore > existing.invalidBefore) {
        await this.#revocations.updateOne({ subjectId }, { invalidBefore });
      }
    } else {
      await this.#revocations.create({ subjectId, invalidBefore });
    }
  }

  async getInvalidBefore(subjectId: string): Promise<number | null> {
    const row = await this.#revocations.findOne({ subjectId });
    return row ? row.invalidBefore : null;
  }

  // ── Maintenance ──────────────────────────────────────────────────────────────

  async gc(now: number = this.#now()): Promise<number> {
    let purged = 0;
    // 1. Denylist `jti` expirée.
    purged += await this.#denied.delete({ expiresAt: { $lte: now } });
    // 2. Records arrivés à expiration (refresh, y compris révoqués par rotation :
    //    conservés jusqu'à leur `exp` = fenêtre de détection de rejeu). Les
    //    records sans `exp` (`expiresAt` NULL) sont naturellement exclus (`NULL
    //    <= now` est faux en SQL) → traités au point 3.
    purged += await this.#records.delete({ expiresAt: { $lte: now } });
    // 3. PAT révoqués SANS expiration au-delà de la rétention (le `IS NULL` n'est
    //    pas exprimable en critère portable → filtre JS).
    const cutoff = now - this.#retentionRevokedMs;
    const revoked = await this.#records.find({ revokedAt: { $lte: cutoff } });
    const staleIds = revoked
      .filter((record) => record.expiresAt === null)
      .map((record) => record.id);
    if (staleIds.length > 0) {
      purged += await this.#records.delete({ id: { $in: staleIds } });
    }
    return purged;
  }
}
