/**
 * Tags de **politique de boot** posés sur les listeners de lifecycle d'un
 * {@link Module} — la couche POLITIQUE de la résilience de boot (cf
 * `Event.emitAsyncGuarded` = la MÉCANIQUE générique, qui, elle, ignore tout de la
 * notion de module/criticité).
 *
 * `Module.setEvents()` tague chaque hook (`onKernelRegister/Boot/Ready`) avec son
 * propriétaire (`owner`) et sa criticité (`critical`) ; `Kernel.fireLifecycle()`
 * relit ces tags via {@link readListenerTags} pour décider, en cas d'échec, de
 * propager (module critique en production) ou de continuer (fail-soft).
 *
 * @module
 */

/** Clés non énumérables-friendly posées sur la fonction listener. */
interface TaggedListener {
  __nodefony_owner?: string;
  __nodefony_critical?: boolean;
  /** Présent sur le wrapper interne créé par `EventEmitter.once`. */
  listener?: TaggedListener;
}

/** Tags relus depuis un listener (valeurs `undefined` si non tagué). */
export interface IListenerTags {
  /** Nom du module propriétaire du hook, ou `undefined` (listener interne/anonyme). */
  owner?: string;
  /** Criticité déclarée du module, ou `undefined` (→ traité comme critique par défaut). */
  critical?: boolean;
}

/**
 * Pose `owner` + `critical` sur une fonction listener, **en place**, et la renvoie.
 *
 * @typeParam F - type de la fonction (préservé).
 * @param fn - listener (typiquement `hook.bind(module)`).
 * @param owner - nom du module propriétaire.
 * @param critical - criticité du module (cf `Module.critical`).
 * @returns la même fonction `fn`, taguée.
 */
export function tagListener<F extends object>(
  fn: F,
  owner: string,
  critical: boolean,
): F {
  const tagged = fn as TaggedListener;
  tagged.__nodefony_owner = owner;
  tagged.__nodefony_critical = critical;
  return fn;
}

/**
 * Relit les tags d'un listener. **Déballe le wrapper `once`** : `rawListeners()`
 * renvoie le wrapper interne d'`EventEmitter.once` (qui porte `.listener` =
 * fonction d'origine) — les hooks de module étant câblés via `kernel.once(...)`,
 * lire les tags directement sur le wrapper renverrait toujours `undefined`.
 *
 * @param fn - listener (wrapper `once` ou fonction directe).
 * @returns `{ owner, critical }` (valeurs `undefined` si non tagué).
 */
export function readListenerTags(fn: unknown): IListenerTags {
  if (fn == null) {
    return {};
  }
  // `fn` est soit le wrapper `once` (une FONCTION portant `.listener`), soit la
  // fonction taguée elle-même. On lit des propriétés optionnelles → cast neutre.
  const wrapper = fn as TaggedListener;
  const target = wrapper.listener ?? wrapper;
  return {
    owner: target.__nodefony_owner,
    critical: target.__nodefony_critical,
  };
}
