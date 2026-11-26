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
   * Un report SOUPLE : une commande lancée depuis l'invite tourne encore, et
   * recharger maintenant bâtirait sous elle. Le cycle attend comme sous une
   * suspension — mais `restartNow` (le verbe `restart`) passe outre, là où
   * il ne force jamais le verrou du serveur. Absent : aucun report.
   */
  isDeferred?(): boolean;
  /**
   * Reconstruit ce qui a changé.
   *
   * @param files - fichiers modifiés depuis le cycle précédent.
   * @returns `false` quand le build échoue : le serveur courant est conservé.
   */
  build(files: readonly string[]): Promise<boolean>;
  /**
   * Faut-il remplacer le serveur après le build de ces fichiers ? Absent :
   * toujours (le geste historique).
   *
   * @param files - fichiers du cycle.
   * @returns `false` quand le serveur courant n'a rien chargé de ce qui change.
   */
  needsSwap?(files: readonly string[]): boolean;
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
  /** Délai de {@link #timer} : un même délai se réarme par `refresh()`, sans allocation. */
  #timerMs = 0;
  #busy = false;
  #pending = false;
  /** Fin de l'anti-rebond — une seule fermeture pour toute la vie du cycle. */
  readonly #fire = (): void => {
    this.#timer = null;
    void this.run();
  };

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
   * Appelé à CHAQUE événement du watcher — une rafale de `git checkout` en
   * compte des milliers : le minuteur se réarme en place, rien n'est alloué.
   *
   * @param file - fichier modifié, tel que le watcher le rapporte.
   * @returns le nombre de fichiers en attente si `file` est NOUVEAU dans le
   *   cycle, `0` s'il y était déjà (un éditeur émet 2 à 3 événements par
   *   sauvegarde).
   */
  mark(file: string): number {
    const before = this.#dirty.size;
    this.#dirty.add(file);
    this.#arm(this.#debounceMs);
    const after = this.#dirty.size;
    return after === before ? 0 : after;
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
    if (this.#steps.isSuspended() || this.#steps.isDeferred?.() === true) {
      this.#arm(this.#recheckMs);
      return;
    }
    const files = [...this.#dirty];
    this.#dirty.clear();
    this.#busy = true;
    try {
      const built = await this.#steps.build(files);
      if (
        built &&
        !this.#steps.isStopping() &&
        (this.#steps.needsSwap?.(files) ?? true)
      )
        await this.#steps.swap();
    } finally {
      this.#busy = false;
    }
    this.#replay();
  }

  /**
   * Relance le serveur MAINTENANT (le verbe `restart` de l'invite) — sous la
   * même garde qu'un cycle : jamais deux remplacements concurrents, et une
   * sauvegarde arrivée pendant lui est rejouée.
   *
   * Les fichiers déjà notés — ceux qu'un report souple (`isDeferred`)
   * retenait — sont bâtis d'abord : relancer sur l'ancien `dist` forcerait
   * un rechargement qui n'en serait pas un. Rien de noté : aucun build.
   *
   * @returns `false` si un cycle est en vol, le serveur suspendu ou un arrêt
   *   demandé : rien n'est lancé.
   */
  async restartNow(): Promise<boolean> {
    if (this.#busy || this.#steps.isStopping() || this.#steps.isSuspended()) {
      return false;
    }
    this.#busy = true;
    try {
      if (this.#dirty.size > 0) {
        // Le cycle différé qui attendait part ici : son minuteur n'a plus d'objet.
        this.cancel();
        const files = [...this.#dirty];
        this.#dirty.clear();
        if (!(await this.#steps.build(files)) || this.#steps.isStopping()) {
          return true;
        }
      }
      await this.#steps.swap();
    } finally {
      this.#busy = false;
      // Même en échec : une sauvegarde notée pendant la relance n'est pas perdue.
      this.#replay();
    }
    return true;
  }

  /** Les sauvegardes notées pendant un cycle : un nouveau cycle part. */
  #replay(): void {
    if (!this.#pending || this.#steps.isStopping()) return;
    this.#pending = false;
    // Un rejeu sans fichier relancerait le serveur pour rien.
    if (this.#dirty.size === 0) return;
    this.#steps.onReplay?.(this.#dirty.size);
    this.#arm(this.#debounceMs);
  }

  #arm(ms: number): void {
    if (this.#timer !== null && this.#timerMs === ms) {
      this.#timer.refresh();
      return;
    }
    this.cancel();
    this.#timerMs = ms;
    this.#timer = setTimeout(this.#fire, ms);
  }
}
