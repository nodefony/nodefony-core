/**
 * Étapes qu'un {@link RestartCycle} enchaîne — le superviseur de développement
 * les fournit, un test les simule.
 */
export interface IRestartSteps {
  /** Un arrêt du superviseur est demandé : plus aucun cycle ne part. */
  isStopping(): boolean;
  /**
   * Le serveur écrit en ce moment dans les sources (verrou de suspension) : le
   * cycle attend la levée, les fichiers modifiés restent notés.
   */
  isSuspended(): boolean;
  /**
   * Reconstruit ce qui a changé.
   *
   * @param files - fichiers modifiés depuis le cycle précédent.
   * @returns `false` quand le build échoue : le serveur courant est conservé.
   */
  build(files: readonly string[]): Promise<boolean>;
  /** Remplace le serveur : arrêt de l'ancien, attente des ports, relance. */
  swap(): Promise<void>;
  /**
   * Des sauvegardes sont arrivées pendant le cycle : un nouveau cycle va partir.
   *
   * @param count - nombre de fichiers en attente.
   */
  onReplay?(count: number): void;
}

/** Délais d'un {@link RestartCycle}, en millisecondes. */
export interface IRestartCycleOptions {
  /** Anti-rebond : sauvegardes rapprochées regroupées en un seul cycle. */
  debounceMs: number;
  /** Intervalle de relecture du verrou de suspension. */
  recheckMs: number;
}

/**
 * Cycle de rechargement du superviseur de développement : regroupe les
 * sauvegardes rapprochées, puis reconstruit et remplace le serveur — UN seul
 * cycle à la fois, et aucune sauvegarde perdue.
 *
 * Le cycle est occupé de la reconstruction jusqu'à la relance du serveur
 * COMPRISE : une sauvegarde qui tombe pendant l'arrêt de l'ancien serveur ne
 * lance pas un second cycle concurrent (deux serveurs sur les mêmes ports, le
 * premier devenu orphelin) — elle est notée et rejouée à la fin. Une sauvegarde
 * notée pendant un build EN ÉCHEC est rejouée de même : c'est en général la
 * correction de l'erreur que le build vient de signaler.
 */
export class RestartCycle {
  readonly #steps: IRestartSteps;
  readonly #debounceMs: number;
  readonly #recheckMs: number;
  readonly #dirty = new Set<string>();
  #timer: ReturnType<typeof setTimeout> | null = null;
  #busy = false;
  #pending = false;

  constructor(steps: IRestartSteps, options: IRestartCycleOptions) {
    this.#steps = steps;
    this.#debounceMs = options.debounceMs;
    this.#recheckMs = options.recheckMs;
  }

  /** Vrai de la reconstruction jusqu'à la relance du serveur comprise. */
  get busy(): boolean {
    return this.#busy;
  }

  /**
   * Note une sauvegarde et réarme l'anti-rebond.
   *
   * @param file - fichier modifié, tel que le watcher le rapporte.
   */
  mark(file: string): void {
    this.#dirty.add(file);
    this.#arm(this.#debounceMs);
  }

  /** Annule le cycle programmé ; un cycle en vol termine l'étape en cours. */
  cancel(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
  }

  /** Lance un cycle maintenant — appelé à la fin de l'anti-rebond. */
  async run(): Promise<void> {
    if (this.#steps.isStopping()) return;
    if (this.#busy) {
      this.#pending = true;
      return;
    }
    if (this.#steps.isSuspended()) {
      this.#arm(this.#recheckMs);
      return;
    }
    const files = [...this.#dirty];
    this.#dirty.clear();
    this.#busy = true;
    try {
      const built = await this.#steps.build(files);
      if (built && !this.#steps.isStopping()) await this.#steps.swap();
    } finally {
      this.#busy = false;
    }
    if (!this.#pending || this.#steps.isStopping()) return;
    this.#pending = false;
    // Un rejeu sans fichier relancerait le serveur pour rien.
    if (this.#dirty.size === 0) return;
    this.#steps.onReplay?.(this.#dirty.size);
    this.#arm(this.#debounceMs);
  }

  #arm(ms: number): void {
    this.cancel();
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.run();
    }, ms);
  }
}
