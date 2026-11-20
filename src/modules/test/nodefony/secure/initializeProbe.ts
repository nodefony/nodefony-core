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
 *
 * L'état se compte PAR TÉMOIN (valeur de l'en-tête `x-witness`, propre à
 * chaque cas de banc) : les suites de `http` et de `framework` tournent en
 * parallèle contre le même serveur et passent toutes par `SecureController`.
 * Un compteur global se faisait fausser par leurs requêtes — même patron que
 * `GrpcEchoController` (`x-witness`).
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

/**
 * Témoins suivis au plus : un banc n'en ouvre que quelques-uns ; au-delà, le
 * registre repart à vide plutôt que de grossir pour des requêtes sans lecteur.
 */
const WITNESS_LIMIT = 256;

const byWitness = new Map<string, InitializeProbeSnapshot>();

/**
 * Enregistre un passage dans `initialize()`, sous le témoin de la requête.
 *
 * @param witness - valeur de `x-witness` (`""` pour une requête sans témoin)
 * @param identity - identité vue dans l'ALS
 * @param session - session déjà ouverte
 */
export function recordInitializeRun(
  witness: string,
  identity: string | null,
  session: boolean,
): void {
  const previous = byWitness.get(witness);
  if (previous === undefined && byWitness.size >= WITNESS_LIMIT) {
    byWitness.clear();
  }
  byWitness.set(witness, {
    runs: (previous?.runs ?? 0) + 1,
    identity,
    session,
  });
}

/**
 * Lecture du mouchard d'un témoin (copie — l'appelant ne mute pas l'état).
 *
 * @param witness - témoin du cas de banc
 * @returns l'état vu sous ce témoin, zéro passage s'il n'en a aucun
 */
export function readInitializeProbe(witness: string): InitializeProbeSnapshot {
  const snapshot = byWitness.get(witness);
  return snapshot === undefined
    ? { runs: 0, identity: null, session: false }
    : { ...snapshot };
}

/**
 * Remise à zéro d'un témoin entre deux cas de banc.
 *
 * @param witness - témoin du cas de banc
 */
export function resetInitializeProbe(witness: string): void {
  byWitness.delete(witness);
}
