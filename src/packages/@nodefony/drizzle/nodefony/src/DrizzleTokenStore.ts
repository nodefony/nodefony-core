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
 * Les écritures conditionnelles portent leur condition dans le `WHERE` plutôt
 * que dans un `if` JS après lecture (`{ revokedAt: { $null: true } }`) : chacune
 * est une instruction unique, donc atomique — un `findOne` suivi d'un `update`
 * laisse deux appels concurrents agir sur un état déjà périmé.
 *
 * Horloge injectable (`now`) pour des tests déterministes.
 */
export class DrizzleTokenStore implements ITokenStore {
  readonly #records: IRepository<IAccessTokenRecord>;
  readonly #denied: IRepository<DeniedJtiRow>;
  readonly #revocations: IRepository<SubjectRevocationRow>;
  readonly #now: () => number;
  readonly #retentionRevokedMs: number;
  readonly #location: string | undefined;

  /**
   * @param records - repository de la table `access_token` (PAT + refresh).
   * @param denied - repository de la denylist `denied_jti`.
   * @param revocations - repository des seuils `subject_revocation`.
   * @param now - horloge (epoch ms) injectable pour les tests.
   * @param retentionRevokedMs - rétention d'un PAT révoqué sans `exp` avant purge.
   * @param location - emplacement physique de la base (fichier SQLite) pour Studio
   *   ({@link DrizzleOrm.location}) ; `undefined` pour un backend réseau/`:memory:`.
   */
  constructor(
    records: IRepository<IAccessTokenRecord>,
    denied: IRepository<DeniedJtiRow>,
    revocations: IRepository<SubjectRevocationRow>,
    now: () => number = Date.now,
    retentionRevokedMs: number = DEFAULT_RETENTION_REVOKED_MS,
    location?: string,
  ) {
    this.#records = records;
    this.#denied = denied;
    this.#revocations = revocations;
    this.#now = now;
    this.#retentionRevokedMs = retentionRevokedMs;
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
      orm.location,
    );
  }

  // ── Records ────────────────────────────────────────────────────────────────

  /**
   * Insère ou remplace un record (PAT / refresh) — 1 requête, `upsert` atomique
   * sur la PK `id` plutôt qu'un `findOne` d'existence + `create`/`updateOne`
   * (2 round-trips). `put` pose le record COMPLET (`createdAt` inclus) → tout
   * hors `id` est ré-appliqué en cas de conflit ; pas de champ insert-only.
   *
   * ⚠️ **Limite `ON CONFLICT`, propre à cette table** : `access_token` porte
   * DEUX contraintes uniques (`id` PK + `secretHash`), or un upsert n'arbitre
   * qu'UN index. Deux INSERT **concurrents** d'un record **absent** partageant
   * le même `secretHash` feraient donc lever le perdant (PG : `23505` sur
   * `access_token_secretHash_unique`) — l'arbitre `id` ne couvre pas la seconde
   * unique. Ce n'est pas atteignable : les trois appelants (`tokenService`
   * émission + rotation, `apiKeys`) posent un `id` **généré** (`randomUUID` /
   * `#randomId`), donc jamais deux `put` du même id neuf ; le seul `put`
   * concurrent d'un même id porte sur une ligne **existante** (rotation
   * rejouée), qui tombe sur le chemin DO UPDATE et passe. Une entité à deux
   * uniques dont les DEUX seraient réellement disputées demanderait un autre
   * remède (réservation en deux instructions, cf `reserveIdempotencyKeyMysql`).
   *
   * @param record - le record complet à persister.
   */
  async put(record: IAccessTokenRecord): Promise<void> {
    const { id, ...rest } = record;
    await this.#records.upsert({ id }, rest as Partial<IAccessTokenRecord>);
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

  /**
   * Révoque un jeton — **idempotent** : la 1ʳᵉ date/raison de révocation est
   * conservée (l'audit ne se réécrit pas).
   *
   * Le « pas encore révoqué » vit dans le `WHERE` (`revokedAt IS NULL`), pas
   * dans un `if` JS après lecture : une seule instruction, donc deux révocations
   * concurrentes ne peuvent plus se recouvrir (la seconde n'affecte 0 ligne au
   * lieu d'écraser la date de la première).
   *
   * @param id - identifiant du jeton.
   * @param reason - motif de révocation, posé seulement à la 1ʳᵉ.
   */
  async revoke(id: string, reason: TokenRevokeReason): Promise<void> {
    await this.#records.updateOne(
      { id, revokedAt: { $null: true } },
      { revokedAt: this.#now(), revokedReason: reason },
    );
  }

  /**
   * Coupe toute une famille de refresh (détection de rejeu, RFC 9700) — les
   * membres déjà révoqués (ex. `rotated`) gardent leur raison d'origine.
   *
   * Un seul `UPDATE … WHERE family = ? AND revokedAt IS NULL` : atomique, et
   * N+1 requêtes (1 SELECT + 1 UPDATE par membre actif) tombent à 1.
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
    // UPSERT atomique sur la PK `jti` (cf `put`) : deux dénonciations
    // simultanées du même jeton ne doivent pas faire remonter une erreur.
    await this.#denied.upsert({ jti }, { expiresAt });
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
    // 3. PAT révoqués SANS expiration au-delà de la rétention. Le `IS NULL` est
    //    dans le critère (`$null`) → un seul DELETE : plus de `find` de TOUS les
    //    révoqués rapatriés en RAM pour un filtre JS `expiresAt === null` (la
    //    purge ne dépend plus du volume purgé).
    purged += await this.#records.delete({
      revokedAt: { $lte: now - this.#retentionRevokedMs },
      expiresAt: { $null: true },
    });
    return purged;
  }
}
