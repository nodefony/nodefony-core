/**
 * Mouchard d'ORDRE du pipeline : que voit `Controller.initialize()`, et
 * s'exécute-t-il même quand la requête sera refusée ?
 *
 * `initialize()` est le constructeur asynchrone d'un controller. La question
 * n'est pas sa place relative à l'instanciation (elle est juste), mais la place
 * de l'instanciation dans le pipeline : si elle précède le firewall, tout code
 * utilisateur posé là s'exécute **pour un appelant qui sera rejeté** — sans
 * identité, sans CSRF validé, et en payant la résolution DI.
 *
 * Ce module tient l'état HORS du controller (une instance par requête ne
 * survivrait pas à sa requête) et le module `test` l'expose par une route
 * publique, la seule lisible depuis un banc anonyme.
 */

/** Ce qu'`initialize()` avait sous la main, au moment où il a tourné. */
export interface InitializeProbeSnapshot {
  /** Nombre d'exécutions depuis le dernier `resetInitializeProbe()`. */
  runs: number;
  /** Identité vue dans l'ALS — `null` tant que le firewall n'a pas authentifié. */
  identity: string | null;
  /** Session déjà ouverte à ce moment (le kernel l'ouvre après, cf pipeline). */
  session: boolean;
}

const state: InitializeProbeSnapshot = {
  runs: 0,
  identity: null,
  session: false,
};

/** Enregistre un passage dans `initialize()`. */
export function recordInitializeRun(
  identity: string | null,
  session: boolean,
): void {
  state.runs += 1;
  state.identity = identity;
  state.session = session;
}

/** Lecture du mouchard (copie — l'appelant ne mute pas l'état). */
export function readInitializeProbe(): InitializeProbeSnapshot {
  return { ...state };
}

/** Remise à zéro entre deux cas de banc. */
export function resetInitializeProbe(): void {
  state.runs = 0;
  state.identity = null;
  state.session = false;
}
