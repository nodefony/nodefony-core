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

/**
 * Événement kernel — les droits d'une identité ont changé (ses rôles, par
 * exemple), sans qu'elle soit morte. Une connexion longue a FIGÉ cette
 * identité à l'ouverture : elle doit se fermer pour que le client se
 * reconnecte avec l'identité à jour. Re-lire la base à chaque tick pour le
 * détecter coûterait une lecture par connexion ; l'événement ne coûte rien
 * tant que rien ne change. Charge utile : {@link IIdentityChangedEvent}.
 *
 * Défini au cœur parce que ses abonnés (`@nodefony/http` pour les flux SSE,
 * `@nodefony/realtime` pour les sockets) ne dépendent pas du paquet qui
 * l'émet (`@nodefony/user`).
 */
export const IDENTITY_CHANGED_EVENT = "onIdentityChanged";

/** Charge utile de {@link IDENTITY_CHANGED_EVENT}. */
export interface IIdentityChangedEvent {
  /** Identifiant de connexion de l'identité dont les droits ont changé. */
  readonly identifier: string;
}

/** Ce que le registre sait faire d'une entrée — fourni par son propriétaire. */
export interface IRevocationPolicy<T> {
  /**
   * L'identité de l'entrée est-elle toujours valable ? Un rejet vaut `false`
   * (fail-closed). `undefined` = rien à re-valider, l'entrée reste.
   */
  isValid(entry: T): Promise<boolean> | boolean | undefined;
  /** Ferme la connexion de l'entrée — appelée une fois, l'entrée déjà retirée. */
  revoke(entry: T): void;
  /**
   * Identifiant de connexion de l'identité figée par l'entrée — `undefined` si
   * elle n'en porte pas. Sans cette méthode, {@link RevocationWatch.refreshIdentity}
   * ne ferme rien.
   */
  identityOf?(entry: T): string | undefined;
  /**
   * Ferme l'entrée pour que son client se RECONNECTE avec une identité à jour —
   * à distinguer de `revoke`, qui signifie « identité morte ». Absent : `revoke`.
   */
  refresh?(entry: T): void;
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

  /**
   * Ferme, tout de suite, les entrées qui ont figé cette identité — ses droits
   * ont changé ({@link IDENTITY_CHANGED_EVENT}). L'entrée est retirée AVANT sa
   * fermeture, comme à la révocation.
   *
   * @param identifier - identifiant de connexion de l'identité changée.
   * @returns le nombre d'entrées fermées.
   */
  refreshIdentity(identifier: string): number {
    const policy = this.#policy;
    if (this.#entries === null || policy.identityOf === undefined) return 0;
    let closed = 0;
    for (const entry of Array.from(this.#entries)) {
      if (policy.identityOf(entry) !== identifier) continue;
      this.unregister(entry);
      closed += 1;
      try {
        // Appel en MÉTHODE : une politique qui lit `this` le garde.
        if (policy.refresh) policy.refresh(entry);
        else policy.revoke(entry);
      } catch {
        /* connexion déjà fermée : son propre nettoyage finira le travail */
      }
    }
    return closed;
  }
}

export default RevocationWatch;
