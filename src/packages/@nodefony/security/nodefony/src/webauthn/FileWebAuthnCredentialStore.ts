import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  MemoryWebAuthnCredentialStore,
  type WebAuthnStoreSnapshot,
} from "./MemoryWebAuthnCredentialStore";
import type { IWebAuthnCredential } from "../../contracts/IWebAuthnCredential";
import type { WebAuthnAuthUpdate } from "../../contracts/IWebAuthnCredentialStore";

/**
 * Store de credentials WebAuthn **sur fichier** (JSON) —
 * {@link MemoryWebAuthnCredentialStore} + persistance. Toute la logique d'index
 * est héritée ; on n'ajoute QUE l'écriture/lecture disque.
 *
 * L'état tient en RAM (lectures O(1)) et est sérialisé sur disque après chaque
 * écriture, via un flush **différé/coalescé** (un seul write par rafale, timer
 * `unref` → ne retient pas le process). L'écriture est **atomique** (fichier
 * temporaire + `rename` sur le même système de fichiers) → jamais de fichier à
 * moitié écrit, même si le process meurt pendant l'écriture. {@link flushNow}
 * force le write à l'arrêt propre du service ⇒ **zéro perte au redémarrage**
 * (le seul debounce, lui, peut perdre la dernière rafale si le kill arrive avant).
 *
 * Cible : développement / déploiement **mono-process** persistant (les passkeys
 * survivent au redémarrage). PAS pour le multi-process : un seul fichier, pas de
 * verrou inter-process → en cluster/prod, adapter ORM ou Redis.
 *
 * Robustesse boot : fichier absent = état vide ; illisible/corrompu = on repart
 * vide sans throw (le prochain flush réécrit un fichier sain).
 */
export class FileWebAuthnCredentialStore extends MemoryWebAuthnCredentialStore {
  readonly #path: string;
  readonly #debounceMs: number;
  #flushTimer: ReturnType<typeof setTimeout> | null = null;
  // Sérialise les écritures entre elles (évite deux `rename` concurrents).
  #writing: Promise<void> | null = null;

  /** Emplacement physique du fichier JSON — introspection Studio (« où sont mes passkeys ? »). */
  get location(): string {
    return this.#path;
  }

  constructor(path: string, debounceMs = 50) {
    super();
    this.#path = path;
    this.#debounceMs = debounceMs;
    if (existsSync(path)) {
      try {
        this.restore(
          JSON.parse(readFileSync(path, "utf8")) as WebAuthnStoreSnapshot,
        );
      } catch {
        // Corrompu/illisible → état vide, pas de throw au boot.
      }
    }
  }

  override async save(credential: IWebAuthnCredential): Promise<void> {
    await super.save(credential);
    this.#scheduleFlush();
  }

  override async update(
    credentialId: string,
    patch: WebAuthnAuthUpdate,
  ): Promise<void> {
    await super.update(credentialId, patch);
    this.#scheduleFlush();
  }

  override async delete(credentialId: string): Promise<void> {
    await super.delete(credentialId);
    this.#scheduleFlush();
  }

  /**
   * Écrit immédiatement l'état sur disque — à appeler à l'arrêt propre du
   * service (`onTerminate`) pour ne perdre aucune écriture en attente de flush.
   */
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
    // Attend une écriture en cours (le dernier snapshot l'emporte).
    while (this.#writing) {
      await this.#writing;
    }
    const run = (async () => {
      const data = JSON.stringify(this.snapshot());
      await mkdir(dirname(this.#path), { recursive: true });
      const tmp = `${this.#path}.${process.pid}.tmp`;
      await writeFile(tmp, data, "utf8");
      await rename(tmp, this.#path); // atomique sur le même FS
    })();
    this.#writing = run.finally(() => {
      this.#writing = null;
    });
    await this.#writing;
  }
}

export default FileWebAuthnCredentialStore;
