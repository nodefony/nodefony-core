/**
 * Registre de disponibilité — ce qui RETIENT la mise en service d'un processus.
 *
 * Un pod qui écoute n'est pas un pod qui peut servir : son schéma de base peut
 * être en retard, un cache peut n'être pas chaud, un service tiers peut n'avoir
 * pas encore répondu. Ce registre donne à ces composants le seul mot qui leur
 * manquait — « pas encore » — et l'orchestrateur en tire la conséquence : il
 * n'envoie pas de trafic, l'ancien exemplaire continue de servir.
 *
 * ## La forme est imposée par le chemin sur lequel elle est lue
 *
 * La sonde `/readyz` est interrogée toutes les 2 à 10 secondes par le kubelet et
 * court-circuite TOUT le pipeline (pas de contexte, pas de portée d'injection,
 * réponses pré-allouées). Le registre stocke donc un **verdict déjà calculé** :
 * un booléen posé par le contributeur, jamais une fonction que la sonde
 * attendrait. Lire la disponibilité coûte une comparaison d'entier — zéro
 * `await`, zéro allocation, zéro appel système.
 *
 * Conséquence directe, et c'est la propriété qui fait tout l'intérêt du
 * mécanisme : **une sonde qui interroge une base tombe avec elle.** Ici elle ne
 * peut pas : elle lit ce que le contributeur a déjà décidé, à son propre rythme.
 * Et dès que la cause extérieure est levée — le travail de migration appliqué,
 * par exemple —, le contributeur repose son verdict et le processus redevient
 * disponible **tout seul**, sans redéploiement.
 *
 * Ce registre n'est pas alloué tant que personne ne s'inscrit : le Kernel le
 * garde à `null` et le libère quand le dernier contributeur se retire (cf
 * {@link Kernel.setReadiness}).
 *
 * @remarks
 * À ne pas confondre avec `checks/readiness.ts`, qui regarde une tout autre
 * question — ce qui empêchera l'application de DÉMARRER sur cette machine
 * (variable absente, module non installé), constaté par la commande `check`
 * avant tout démarrage. Ici il s'agit d'un processus DÉJÀ démarré, et de savoir
 * s'il peut recevoir du trafic maintenant.
 */

/** Un contributeur et son verdict, tels qu'un diagnostic les restitue. */
export interface IReadinessContributor {
  /** Nom du contributeur — celui qui apparaît au journal et au diagnostic. */
  readonly name: string;
  /** Verdict déjà calculé : `false` retient la mise en service. */
  readonly ready: boolean;
  /** Ce qui retient, en clair — absent quand le contributeur est prêt. */
  readonly reason?: string;
}

/**
 * Ce que le registre garde par contributeur. `reason` est toujours PRÉSENT —
 * remis à `undefined`, jamais retiré par `delete` : la forme de l'entrée reste
 * stable pour le moteur.
 */
interface ReadinessEntry {
  ready: boolean;
  reason: string | undefined;
}

/**
 * Les contributeurs et le compte de ceux qui retiennent la mise en service.
 *
 * Objet nu (`Object.create(null)`) plutôt que `Map` : quelques entrées, accès
 * ponctuel, aucun héritage de prototype à craindre sur un nom venu d'un module.
 * Le compte des non-prêts est tenu À L'ÉCRITURE — il n'est jamais recalculé par
 * parcours, puisque c'est la lecture qui doit rester gratuite.
 */
export class ReadinessRegistry {
  private entries: Record<string, ReadinessEntry> = Object.create(null);
  private notReady: number = 0;
  private tracked: number = 0;

  /** Nombre de contributeurs qui retiennent la mise en service (0 = disponible). */
  get blocked(): number {
    return this.notReady;
  }

  /** Nombre de contributeurs inscrits, prêts ou non. */
  get size(): number {
    return this.tracked;
  }

  /**
   * Inscrit ou met à jour un contributeur nommé. Idempotent par nom : un même
   * nom réenregistré remplace son verdict, il n'ajoute jamais une seconde voix.
   *
   * @param name - nom du contributeur (`"drizzle:schema"`, `"cache"`…)
   * @param ready - verdict DÉJÀ calculé ; `false` retient la mise en service
   * @param reason - ce qui retient, en clair — ignoré quand `ready` est vrai
   * @returns `true` si le verdict AGRÉGÉ a basculé (retenu ⇄ disponible)
   */
  set(name: string, ready: boolean, reason?: string): boolean {
    const wasBlocked = this.notReady > 0;
    const entry = this.entries[name];
    if (entry === undefined) {
      this.entries[name] = { ready, reason: ready ? undefined : reason };
      this.tracked += 1;
      if (!ready) {
        this.notReady += 1;
      }
    } else {
      if (entry.ready !== ready) {
        entry.ready = ready;
        this.notReady += ready ? -1 : 1;
      }
      entry.reason = ready ? undefined : reason;
    }
    return wasBlocked !== this.notReady > 0;
  }

  /**
   * Retire un contributeur — sa voix ne compte plus, ni pour retenir ni pour
   * libérer. C'est le geste d'un module qui s'arrête.
   *
   * @param name - nom du contributeur
   * @returns `true` si le verdict AGRÉGÉ a basculé (retenu ⇄ disponible)
   */
  clear(name: string): boolean {
    const entry = this.entries[name];
    if (entry === undefined) {
      return false;
    }
    const wasBlocked = this.notReady > 0;
    if (!entry.ready) {
      this.notReady -= 1;
    }
    delete this.entries[name];
    this.tracked -= 1;
    return wasBlocked !== this.notReady > 0;
  }

  /**
   * Restitue les contributeurs pour un diagnostic (journal, `status`, console
   * d'administration) — hors du chemin de la sonde, qui ne lit que
   * {@link ReadinessRegistry.blocked}.
   *
   * @returns un contributeur par entrée, triés par nom (ordre stable)
   */
  report(): IReadinessContributor[] {
    const out: IReadinessContributor[] = [];
    for (const name of Object.keys(this.entries).sort()) {
      const entry = this.entries[name] as ReadinessEntry;
      out.push(
        entry.reason === undefined
          ? { name, ready: entry.ready }
          : { name, ready: entry.ready, reason: entry.reason },
      );
    }
    return out;
  }
}
