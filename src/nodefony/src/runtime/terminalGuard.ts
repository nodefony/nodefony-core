/**
 * Rendre le terminal propre quoi qu'il arrive : UN protocole de sortie pour
 * tout ce qui modifie l'état du terminal (curseur masqué, écran alternatif,
 * mode brut, suivi de la souris). Cf ADR-0013 §5 et §9.
 *
 * Le protocole est celui de `signal-exit`, lu dans ses sources plutôt que de
 * mémoire :
 *
 * 1. sur un signal, n'agir que si nos écouteurs sont les SEULS — sinon
 *    l'application a son propre arrêt gracieux, et c'est à lui de conclure
 *    (le terminal est tout de même restauré, tout de suite) ;
 * 2. se RETIRER avant d'agir, pour ne pas se rappeler soi-même ;
 * 3. réémettre le signal par `process.kill`, JAMAIS `process.exit` :
 *    `process.exit(130)` ment au shell, qui croit à une sortie ordinaire ; un
 *    `^C` doit rester un `^C`.
 *
 * Pourquoi un REGISTRE et pas un écouteur par client : deux gardes posées
 * chacune de leur côté se compteraient l'une l'autre comme « l'application » —
 * aucune ne réémettrait le signal, et Ctrl+C serait avalé. Le registre vit
 * dans `globalThis` pour la même raison que la porte du terminal : le binaire
 * embarque sa propre copie du noyau.
 *
 * Une exception non rattrapée passe par `exit`, que Node émet AVANT
 * d'imprimer la pile (constaté, et tenu par `terminalGuard.test.ts`) : la
 * pile s'imprime donc sur un terminal déjà rendu, jamais dans l'écran
 * alternatif qui l'effacerait.
 */

/** Les signaux d'arrêt écoutés. `SIGHUP` : fermeture du terminal. */
const GUARDED_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

type GuardedSignal = (typeof GUARDED_SIGNALS)[number];

/** État du registre, partagé par toutes les copies du module. */
interface ITerminalGuardState {
  /** Restaurations en attente, dans l'ordre de pose. */
  restores: Array<() => void>;
  /** Retrait des écouteurs, `null` tant qu'ils ne sont pas posés. */
  release: (() => void) | null;
}

const STATE_KEY = Symbol.for("nodefony.terminalGuard");

function guardState(): ITerminalGuardState {
  const holder = globalThis as typeof globalThis & {
    [STATE_KEY]?: ITerminalGuardState;
  };
  holder[STATE_KEY] ??= { restores: [], release: null };
  return holder[STATE_KEY];
}

/**
 * Exécute toutes les restaurations en attente, la dernière posée d'abord, et
 * vide le registre. Une restauration qui lève n'empêche pas les suivantes.
 */
function restoreAll(state: ITerminalGuardState): void {
  const pending = state.restores.splice(0).reverse();
  for (const restore of pending) {
    try {
      restore();
    } catch {
      /* rendre le terminal passe avant tout : on continue */
    }
  }
  detach(state);
}

/** Retire les écouteurs du registre (idempotent). */
function detach(state: ITerminalGuardState): void {
  state.release?.();
  state.release = null;
}

/** Pose les écouteurs une seule fois, au premier client. */
function attach(state: ITerminalGuardState): void {
  if (state.release !== null) return;
  const onExit = (): void => restoreAll(state);
  const onSignal = (signal: GuardedSignal): void => {
    const alone = process.listenerCount(signal) === 1;
    restoreAll(state);
    if (!alone) return;
    reRaise(signal);
  };
  process.on("exit", onExit);
  // EN TÊTE : un écouteur `process.once` est retiré AVANT d'être appelé. Placée
  // après lui, la garde le croirait absent, se jugerait seule et réémettrait
  // le signal — tuant l'arrêt gracieux en cours. En tête, elle compte tout le
  // monde, et rend le terminal avant que l'application n'y écrive son arrêt.
  for (const signal of GUARDED_SIGNALS)
    process.prependListener(signal, onSignal);
  state.release = () => {
    process.removeListener("exit", onExit);
    for (const signal of GUARDED_SIGNALS) {
      process.removeListener(signal, onSignal);
    }
  };
}

/**
 * Réémet le signal pour que le système en applique la sémantique. Une
 * plateforme qui refuse de l'envoyer (Windows et `SIGHUP`) le dit à
 * l'exécution : on retombe sur `SIGINT`, que Node émule partout.
 */
function reRaise(signal: GuardedSignal): void {
  try {
    process.kill(process.pid, signal);
  } catch {
    process.kill(process.pid, "SIGINT");
  }
}

/**
 * Enregistre une restauration du terminal, exécutée une seule fois à la
 * première sortie : fin normale, signal d'arrêt, exception non rattrapée.
 *
 * @param restore - rend le terminal (idempotente de préférence).
 * @returns le retrait, à appeler quand l'état est rendu par le chemin
 *   ordinaire ; sans effet si la restauration a déjà eu lieu.
 */
export function guardTerminal(restore: () => void): () => void {
  const state = guardState();
  state.restores.push(restore);
  attach(state);
  return () => {
    const index = state.restores.indexOf(restore);
    if (index === -1) return;
    state.restores.splice(index, 1);
    if (state.restores.length === 0) detach(state);
  };
}
