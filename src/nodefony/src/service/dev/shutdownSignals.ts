/**
 * Les signaux d'ARRÊT d'un processus qui doit tuer son arbre avant de sortir —
 * le superviseur de développement.
 *
 * Le défaut traité : sous `npm run dev`, un Ctrl+C livre le SIGINT DEUX FOIS au
 * superviseur — une fois par le groupe de premier plan du terminal, une fois
 * RELAYÉ par npm, qui transmet à son enfant les signaux qu'il reçoit. Le relais
 * arrive tantôt dans la même milliseconde (libuv capte alors les deux d'un
 * coup, sans dommage), tantôt bien après — mesuré à 1,5 s (npm 12.2). Écouté
 * par `process.once`, ce second-là tombait sur l'action PAR DÉFAUT de Node :
 * le superviseur mourait au milieu de son arrêt, avant d'avoir tué le
 * serveur — qui, chef de son propre groupe, n'avait pas reçu le Ctrl+C et
 * gardait les ports (#598).
 *
 * D'où deux régimes, et pas un :
 * - un signal qui suit le premier de moins de `duplicateWindowMs` est un
 *   DOUBLON (le relais d'un lanceur) : il est absorbé, l'arrêt propre continue ;
 * - un signal plus tardif est une INSISTANCE (l'arrêt traîne, l'humain
 *   recommence) : il déclenche l'arrêt FORCÉ, qui doit tuer l'arbre lui
 *   aussi — un arrêt forcé qui laisse un orphelin n'est pas un arrêt.
 *
 * Les écouteurs restent posés pendant tout l'arrêt : c'est leur présence qui
 * empêche l'action par défaut. Aucune allocation hors de l'installation.
 */

/** Les signaux qui demandent l'arrêt. `SIGHUP` : fermeture du terminal. */
export const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

/** Un signal d'arrêt écouté. */
export type ShutdownSignal = (typeof SHUTDOWN_SIGNALS)[number];

/**
 * Délai sous lequel un second signal est tenu pour le relais du premier.
 * Le relais de npm a été mesuré jusqu'à 1,5 s après le Ctrl+C. Trois secondes
 * ne retardent rien d'utile : l'arrêt propre est lui-même borné (le serveur
 * passe en SIGKILL après 4 s), et un relais plus tardif encore, pris pour une
 * insistance, ne coûte qu'un arrêt forcé — qui tue l'arbre aussi.
 */
export const DUPLICATE_SIGNAL_WINDOW_MS = 3000;

/** Ce que l'on fait d'un signal d'arrêt. */
export interface IShutdownSignalHandlers {
  /** Premier signal : arrêt propre (le processus sort lui-même à la fin). */
  readonly graceful: (signal: ShutdownSignal) => void;
  /** Signal insistant, arrêt propre déjà en cours : arrêt forcé. */
  readonly force: (signal: ShutdownSignal) => void;
}

/** La surface de `process` dont l'installation a besoin — injectable. */
export interface ISignalTarget {
  on(event: ShutdownSignal, listener: () => void): unknown;
  removeListener(event: ShutdownSignal, listener: () => void): unknown;
}

/** Réglages de {@link installShutdownSignals}, pour les tests surtout. */
export interface IShutdownSignalOptions {
  /** Cible des écouteurs (défaut `process`). */
  readonly target?: ISignalTarget;
  /** Horloge en millisecondes (défaut `performance.now`). */
  readonly now?: () => number;
  /** Fenêtre des doublons (défaut {@link DUPLICATE_SIGNAL_WINDOW_MS}). */
  readonly duplicateWindowMs?: number;
}

/**
 * Branche les signaux d'arrêt : le premier lance l'arrêt propre, un doublon
 * immédiat est absorbé, une insistance force l'arrêt.
 *
 * @param handlers - l'arrêt propre et l'arrêt forcé.
 * @param options - cible, horloge et fenêtre (injectées par les tests).
 * @returns de quoi retirer les écouteurs posés.
 */
export function installShutdownSignals(
  handlers: IShutdownSignalHandlers,
  options: IShutdownSignalOptions = {},
): () => void {
  const target = options.target ?? process;
  const now = options.now ?? (() => performance.now());
  const window = options.duplicateWindowMs ?? DUPLICATE_SIGNAL_WINDOW_MS;
  let firstAt: number | null = null;
  let forced = false;
  const removers: Array<() => void> = [];
  for (const signal of SHUTDOWN_SIGNALS) {
    const listener = (): void => {
      if (firstAt === null) {
        firstAt = now();
        handlers.graceful(signal);
        return;
      }
      if (forced || now() - firstAt < window) return;
      forced = true;
      handlers.force(signal);
    };
    target.on(signal, listener);
    removers.push(() => target.removeListener(signal, listener));
  }
  return () => {
    for (const remove of removers.splice(0)) remove();
  };
}
