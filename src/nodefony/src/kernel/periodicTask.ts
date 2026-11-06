/**
 * Tâches périodiques d'un service : quand elles tournent, et où.
 *
 * Trois pièges que le geste à la main (`setInterval` dans `init()`) ne voit pas,
 * tous constatés sur une application réelle :
 *
 * 1. `init()` tourne à CHAQUE démarrage du noyau — `orm:migrate`, `inspect`,
 *    toute commande CLI comprise. Un `setInterval` posé là purge la base
 *    pendant une migration, sans un avertissement.
 * 2. En grappe (`nodefony cluster -w N`), chaque worker l'exécute : N purges
 *    concurrentes de la même table.
 * 3. Une tâche asynchrone plus lente que sa période s'empile sur elle-même.
 */
import { readWorkerSlot } from "../service/cluster/ClusterManager";

/** Ce que {@link schedulePeriodic} lit du noyau — un `IKernel` le satisfait. */
export interface IPeriodicKernel {
  readonly runProfile: { readonly servers: boolean };
  readonly postReady: boolean;
  once(event: string, listener: () => void): unknown;
  removeListener(event: string, listener: () => void): unknown;
}

/** Ce que {@link schedulePeriodic} lit du service — tout `Service` le satisfait. */
export interface IPeriodicHost {
  readonly kernel: IPeriodicKernel | null;
  log(message: string, severity: "ERROR"): unknown;
}

/**
 * Ce processus est-il le worker qui porte les tâches UNIQUES de la grappe ?
 *
 * Vrai hors grappe (un seul processus), et en grappe pour la place 0 — une place
 * que le maître garde quand il relance un worker mort, si bien que la tâche ne
 * se perd pas. Ne couvre QUE la grappe d'une machine : plusieurs exemplaires
 * (pods) en exécutent chacun une, et l'unicité entre exemplaires exige un
 * verrou partagé (base, Redis).
 *
 * @param env - environnement lu (`process.env` par défaut).
 * @returns `true` si ce processus doit lancer une tâche unique.
 */
export function isLeadWorker(
  env?: Readonly<Record<string, string | undefined>>,
): boolean {
  const slot = readWorkerSlot(env);
  return slot === null || slot === 0;
}

/** Réglages de {@link schedulePeriodic}. */
export interface IPeriodicTaskOptions {
  /**
   * `true` : chaque worker de la grappe lance la tâche (un cache local à
   * rafraîchir). Défaut : le seul worker de tête ({@link isLeadWorker}).
   */
  allWorkers?: boolean;
}

/**
 * Lance `task` toutes les `intervalMs` millisecondes, et SEULEMENT quand
 * l'application sert du trafic.
 *
 * Rien ne part avant la fin du démarrage (`onPostReady`) ; rien ne part du tout
 * dans une commande CLI (`orm:migrate`, `inspect`…), ni hors du worker de tête
 * d'une grappe sauf `allWorkers`. Un passage encore en cours fait sauter le
 * suivant (jamais deux exécutions superposées) ; une erreur est journalisée
 * sur le service, jamais propagée. L'arrêt du noyau arrête la tâche.
 *
 * @example
 * ```ts
 * async init(): Promise<this> {
 *   schedulePeriodic(this, 60_000, () => this.purgeExpired());
 *   return this;
 * }
 * ```
 *
 * @param service - le service qui porte la tâche (son noyau, son journal).
 * @param intervalMs - période, en millisecondes (entier ≥ 1).
 * @param task - le travail ; une promesse rendue est attendue avant le suivant.
 * @param options - {@link IPeriodicTaskOptions}.
 * @returns de quoi arrêter la tâche avant l'arrêt du noyau.
 * @throws RangeError si `intervalMs` n'est pas un entier ≥ 1.
 */
export function schedulePeriodic(
  service: IPeriodicHost,
  intervalMs: number,
  task: () => unknown,
  options: IPeriodicTaskOptions = {},
): () => void {
  if (!Number.isInteger(intervalMs) || intervalMs < 1) {
    throw new RangeError(
      `schedulePeriodic : période invalide (${String(intervalMs)}) — un entier de millisecondes ≥ 1`,
    );
  }
  const kernel = service.kernel;
  // Aucun noyau (service construit dans un test) ou un run qui ne sert pas de
  // trafic : rien à planifier, et ce n'est pas une erreur.
  if (kernel === null || !kernel.runProfile.servers) return () => undefined;
  if (options.allWorkers !== true && !isLeadWorker()) return () => undefined;

  let timer: NodeJS.Timeout | null = null;
  let running = false;
  const settle = (): void => {
    running = false;
  };
  const fail = (error: unknown): void => {
    running = false;
    service.log(
      `tâche périodique en échec : ${error instanceof Error ? error.message : String(error)}`,
      "ERROR",
    );
  };
  const tick = (): void => {
    if (running) return;
    running = true;
    try {
      const out = task();
      if (out instanceof Promise) out.then(settle, fail);
      else settle();
    } catch (error) {
      fail(error);
    }
  };
  const start = (): void => {
    timer = setInterval(tick, intervalMs);
    // Les serveurs gardent le processus vivant : la tâche ne doit pas, elle,
    // retenir un arrêt.
    timer.unref();
  };
  const stop = (): void => {
    if (timer !== null) clearInterval(timer);
    timer = null;
    kernel.removeListener("onPostReady", start);
    kernel.removeListener("onTerminate", stop);
  };
  // `kernel.once` et non `hookKernel` : la règle vise les écouteurs qui peuvent
  // LEVER pendant le démarrage (criticité) — `start` et `stop` ne lèvent pas.
  if (kernel.postReady) start();
  else kernel.once("onPostReady", start);
  kernel.once("onTerminate", stop);
  return stop;
}
