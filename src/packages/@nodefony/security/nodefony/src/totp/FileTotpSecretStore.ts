import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  MemoryTotpSecretStore,
  type TotpStoreSnapshot,
} from "./MemoryTotpSecretStore";
import type { ITotpSecret } from "../../contracts/ITotpSecret";
import type { TotpSecretUpdate } from "../../contracts/ITotpSecretStore";

/**
 * Store de secrets TOTP **sur fichier** (JSON) — {@link MemoryTotpSecretStore} +
 * persistance. Toute la logique est héritée ; on n'ajoute QUE l'écriture/lecture
 * disque, via un flush **différé/coalescé** (un seul write par rafale, timer
 * `unref`) et **atomique** (tmp + `rename`). {@link flushNow} force le write à
 * l'arrêt propre du service ⇒ zéro perte au redémarrage.
 *
 * Cible : développement / déploiement **mono-process** persistant. PAS pour le
 * multi-process (un seul fichier, pas de verrou inter-process) → adapter ORM/Redis.
 * Boot robuste : fichier absent/corrompu = état vide sans throw.
 *
 * ⚠️ Le `secretEnc` persisté est **déjà chiffré** par le service (AES-256-GCM) :
 * le fichier ne contient jamais le secret TOTP en clair.
 */
export class FileTotpSecretStore extends MemoryTotpSecretStore {
  readonly #path: string;
  readonly #debounceMs: number;
  #flushTimer: ReturnType<typeof setTimeout> | null = null;
  #writing: Promise<void> | null = null;

  constructor(path: string, debounceMs = 50) {
    super();
    this.#path = path;
    this.#debounceMs = debounceMs;
    if (existsSync(path)) {
      try {
        this.restore(
          JSON.parse(readFileSync(path, "utf8")) as TotpStoreSnapshot,
        );
      } catch {
        // Corrompu/illisible → état vide, pas de throw au boot.
      }
    }
  }

  override async save(secret: ITotpSecret): Promise<void> {
    await super.save(secret);
    this.#scheduleFlush();
  }

  override async update(
    userId: string,
    patch: TotpSecretUpdate,
  ): Promise<void> {
    await super.update(userId, patch);
    this.#scheduleFlush();
  }

  override async delete(userId: string): Promise<void> {
    await super.delete(userId);
    this.#scheduleFlush();
  }

  /** Écrit immédiatement l'état sur disque — à appeler à l'arrêt propre du service. */
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

  /** Sérialise l'état et l'écrit de façon **atomique** (tmp + rename). */
  async #flush(): Promise<void> {
    while (this.#writing) {
      await this.#writing;
    }
    const run = (async () => {
      const data = JSON.stringify(this.snapshot());
      await mkdir(dirname(this.#path), { recursive: true });
      const tmp = `${this.#path}.${process.pid}.tmp`;
      await writeFile(tmp, data, "utf8");
      await rename(tmp, this.#path);
    })();
    this.#writing = run.finally(() => {
      this.#writing = null;
    });
    await this.#writing;
  }
}

export default FileTotpSecretStore;
