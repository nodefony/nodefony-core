/**
 * Période de re-validation des connexions à identité RÉVOCABLE, en ms.
 *
 * Une connexion longue — socket WebSocket, flux SSE — fige son identité à
 * l'ouverture : rien ne la re-lit ensuite, et elle survivrait à sa session (un
 * administrateur déconnecté garderait ses flux). Ce tick ferme l'écart : toutes
 * les `REVOCATION_REVALIDATE_MS`, chaque identité inscrite est re-validée et sa
 * connexion fermée si elle ne l'est plus — au plus une fenêtre de délai. Ordre de
 * grandeur aligné sur le battement WebSocket (20 s) et SSE (15 s).
 */
export const REVOCATION_REVALIDATE_MS = 30_000;

/** Ce que le registre sait faire d'une entrée — fourni par son propriétaire. */
export interface IRevocationPolicy<T> {
  /**
   * L'identité de l'entrée est-elle toujours valable ? Un rejet vaut `false`
   * (fail-closed). `undefined` = rien à re-valider, l'entrée reste.
   */
  isValid(entry: T): Promise<boolean> | boolean | undefined;
  /** Ferme la connexion de l'entrée — appelée une fois, l'entrée déjà retirée. */
  revoke(entry: T): void;
  /** Période du tick, en ms. Défaut : {@link REVOCATION_REVALIDATE_MS}. */
  periodMs?: number;
}

/**
 * Registre des connexions longues à identité révocable, re-validées
 * périodiquement — la SEULE implémentation, partagée par le hub WebSocket et les
 * flux SSE : une garde que l'un des transports n'aurait pas serait le chemin
 * qu'un attaquant prendrait.
 *
 * Coût au repos nul : l'ensemble et le minuteur naissent à la première
 * inscription, et le minuteur s'arrête dès que le registre se vide. Il est
 * `unref` : il ne retient jamais l'arrêt du process.
 */
export class RevocationWatch<T> {
  readonly #policy: IRevocationPolicy<T>;
  #entries: Set<T> | null = null;
  #timer: ReturnType<typeof setInterval> | null = null;

  constructor(policy: IRevocationPolicy<T>) {
    this.#policy = policy;
  }

  /** Nombre d'entrées inscrites. */
  get size(): number {
    return this.#entries?.size ?? 0;
  }

  /**
   * Inscrit une entrée ; démarre le tick à la première. À équilibrer par
   * {@link unregister} à la fermeture de la connexion.
   */
  register(entry: T): void {
    (this.#entries ??= new Set<T>()).add(entry);
    if (this.#timer === null) {
      this.#timer = setInterval(() => {
        void this.revalidate();
      }, this.#policy.periodMs ?? REVOCATION_REVALIDATE_MS);
      this.#timer.unref();
    }
  }

  /** Retire une entrée (idempotent) ; arrête le tick quand le registre se vide. */
  unregister(entry: T): void {
    if (this.#entries === null) return;
    this.#entries.delete(entry);
    if (this.#entries.size === 0 && this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  /**
   * Re-valide toutes les entrées et ferme celles dont l'identité est morte.
   *
   * Fail-closed : une re-validation qui lève ferme aussi. L'ensemble est copié
   * AVANT les attentes — la fermeture d'une connexion la désinscrit — et une
   * entrée révoquée est retirée AVANT sa fermeture, pour qu'un tick suivant ne
   * la referme pas. Publique pour qu'un test la déclenche sans faux minuteur.
   */
  async revalidate(): Promise<void> {
    if (this.#entries === null || this.#entries.size === 0) return;
    // Instantané : fermer une connexion la désinscrit pendant la passe.
    for (const entry of Array.from(this.#entries)) {
      let valid: boolean | undefined;
      try {
        valid = await this.#policy.isValid(entry);
      } catch {
        valid = false;
      }
      if (valid !== false) continue;
      this.unregister(entry);
      try {
        this.#policy.revoke(entry);
      } catch {
        /* connexion déjà fermée : son propre nettoyage finira le travail */
      }
    }
  }
}

export default RevocationWatch;
