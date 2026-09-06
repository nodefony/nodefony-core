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
  __nodefony_unbounded?: boolean;
  /** Présent sur le wrapper interne créé par `EventEmitter.once`. */
  listener?: TaggedListener;
}

/** Tags relus depuis un listener (valeurs `undefined` si non tagué). */
export interface IListenerTags {
  /** Nom du module propriétaire du hook, ou `undefined` (listener interne/anonyme). */
  owner?: string;
  /** Criticité déclarée du module, ou `undefined` (→ traité comme critique par défaut). */
  critical?: boolean;
  /**
   * Nom de la FONCTION listener, quand elle en a un — repli d'identification
   * pour les hooks posés à la main (`kernel.on("onBoot", …)`), qui ne portent
   * aucun `owner`. Sans lui, un échec de boot se journalise « (anonyme) » et ne
   * désigne personne : en production, où l'échec interrompt le boot, le seul
   * indice exploitable disparaît. `undefined` pour une lambda inline anonyme.
   */
  name?: string;
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
 * Marque un listener comme n'étant PAS soumis à la borne de temps du boot.
 *
 * 🔴 Vécu, et c'est le pire mode de panne qui soit : l'action d'une commande est
 * câblée comme un écouteur de cycle de vie (`Command.setEvents`), donc bornée
 * comme un hook de module. Passé vingt secondes, la garde abandonnait
 * l'écouteur en fail-soft, le boot enchaînait sur `finishOrPark(0)` et le
 * processus sortait en **0 au milieu du travail**, sans un mot — `doctor
 * --deep` rendait ainsi un succès muet en plein `npm run test`.
 *
 * La distinction est de NATURE, pas de durée : la borne existe pour qu'un module
 * qui se fige ne gèle pas le DÉMARRAGE. Une commande, elle, EST le programme —
 * une migration, une construction, une suite de tests ou une question posée à
 * l'utilisateur dépassent vingt secondes sans rien avoir d'anormal.
 *
 * @typeParam F - type de la fonction (préservé).
 * @param fn - le listener à marquer.
 * @returns la même fonction `fn`, marquée.
 */
export function tagUnboundedListener<F extends object>(fn: F): F {
  (fn as TaggedListener).__nodefony_unbounded = true;
  return fn;
}

/**
 * Dit si un listener a été marqué par {@link tagUnboundedListener}.
 *
 * **Déballe le wrapper `once`** pour la même raison que {@link readListenerTags} :
 * les actions de commande sont câblées via `kernel.once(...)`, et lire le
 * marquage sur le wrapper interne de Node rendrait toujours `false`.
 *
 * @param fn - listener (wrapper `once` ou fonction directe).
 * @returns `true` si ce listener échappe à la borne de temps du boot.
 */
export function isUnboundedListener(fn: unknown): boolean {
  if (fn == null) return false;
  const wrapper = fn as TaggedListener;
  return (wrapper.listener ?? wrapper).__nodefony_unbounded === true;
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
  // `name` est lu sur la fonction DÉBALLÉE : le wrapper interne d'`EventEmitter
  // .once` s'appelle `onceWrapper`, un nom qui ne désignerait que Node.
  const rawName = (target as { name?: unknown }).name;
  return {
    owner: target.__nodefony_owner,
    critical: target.__nodefony_critical,
    name: typeof rawName === "string" && rawName !== "" ? rawName : undefined,
  };
}
