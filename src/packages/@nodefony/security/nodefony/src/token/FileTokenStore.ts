import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { MemoryTokenStore, type TokenStoreSnapshot } from "./MemoryTokenStore";
import type {
  IAccessTokenRecord,
  ITokenUsage,
  TokenRevokeReason,
} from "../../contracts/ITokenStore";

/**
 * Store de jetons **sur fichier** (JSON) — `MemoryTokenStore` + persistance.
 *
 * Étend la référence mémoire : toute la logique (records, denylist, révocation
 * en masse, gc, reuse detection) est héritée ; on n'ajoute QUE la persistance.
 * L'état tient en RAM (lectures O(1)) et est **sérialisé sur disque** après
 * chaque écriture, via un flush **différé/coalescé** (un seul write par rafale,
 * timer `unref` → ne retient pas le process).
 *
 * Cible : développement **mono-process** persistant (les PAT/refresh survivent au
 * redémarrage). **PAS** pour le multi-process (un seul fichier, pas de
 * verrouillage inter-process) → en cluster/prod, utiliser un adapter ORM/Redis.
 *
 * Robustesse boot : fichier absent = état vide ; fichier illisible/corrompu =
 * on repart vide sans throw (le service logue l'incident).
 */
export class FileTokenStore extends MemoryTokenStore {
  readonly #path: string;
  readonly #debounceMs: number;
  #flushTimer: ReturnType<typeof setTimeout> | null = null;

  /** Emplacement physique du fichier JSON — introspection Studio. */
  get location(): string {
    return this.#path;
  }

  constructor(
    path: string,
    now: () => number = Date.now,
    retentionRevokedMs?: number,
    debounceMs = 50,
  ) {
    super(now, retentionRevokedMs);
    this.#path = path;
    this.#debounceMs = debounceMs;
    if (existsSync(path)) {
      try {
        this.restore(
          JSON.parse(readFileSync(path, "utf8")) as TokenStoreSnapshot,
        );
      } catch {
        // Fichier corrompu/illisible → on repart d'un état vide (le prochain
        // flush réécrira un fichier sain). Pas de throw au boot.
      }
    }
  }

  override async put(record: IAccessTokenRecord): Promise<void> {
    await super.put(record);
    this.#scheduleFlush();
  }

  override async markUsed(id: string, usage: ITokenUsage): Promise<void> {
    await super.markUsed(id, usage);
    this.#scheduleFlush();
  }

  override async revoke(id: string, reason: TokenRevokeReason): Promise<void> {
    await super.revoke(id, reason);
    this.#scheduleFlush();
  }

  override async revokeFamily(
    family: string,
    reason: TokenRevokeReason,
  ): Promise<void> {
    await super.revokeFamily(family, reason);
    this.#scheduleFlush();
  }

  override async denyJti(jti: string, expiresAt: number): Promise<void> {
    await super.denyJti(jti, expiresAt);
    this.#scheduleFlush();
  }

  override async revokeAllForSubject(
    subjectId: string,
    invalidBefore: number,
  ): Promise<void> {
    await super.revokeAllForSubject(subjectId, invalidBefore);
    this.#scheduleFlush();
  }

  override async gc(now?: number): Promise<number> {
    const purged = await super.gc(now);
    if (purged > 0) {
      this.#scheduleFlush();
    }
    return purged;
  }

  /** Écrit immédiatement l'état sur disque (à appeler à l'arrêt propre du service). */
  async flushNow(): Promise<void> {
    if (this.#flushTimer) {
      clearTimeout(this.#flushTimer);
      this.#flushTimer = null;
    }
    await this.#flush();
  }

  /** Programme un flush coalescé (un seul write par rafale d'écritures). */
  #scheduleFlush(): void {
    if (this.#flushTimer) {
      return;
    }
    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = null;
      void this.#flush();
    }, this.#debounceMs);
    this.#flushTimer.unref?.();
  }

  async #flush(): Promise<void> {
    const data = JSON.stringify(this.snapshot());
    await mkdir(dirname(this.#path), { recursive: true });
    await writeFile(this.#path, data, "utf8");
  }
}
