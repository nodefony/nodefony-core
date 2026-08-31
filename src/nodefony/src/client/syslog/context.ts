/**
 * Identités de corrélation **côté navigateur** — ce que le pod pourra recouper quand
 * il recevra un journal venu d'un onglet.
 *
 * Le navigateur n'a pas d'`AsyncLocalStorage` : une erreur JavaScript ne survient dans
 * aucune bulle de requête. « Le `requestId` de la requête qui l'a précédée » n'existe
 * donc pas — deux `fetch` concurrents suffisent à attribuer l'erreur à la mauvaise, et
 * un journal qui ment sur la corrélation coûte plus cher qu'un journal sans corrélation.
 *
 * D'où deux identités séparées, chacune honnête sur ce qu'elle sait :
 *
 * - {@link getPageId} — **toujours** disponible, généré une fois par chargement de page.
 *   C'est lui qui relie entre elles toutes les lignes d'un même onglet. Sans lui, le pod
 *   reçoit des lignes orphelines qu'aucun écran ne peut regrouper.
 * - {@link withRequestId} — pose un `requestId` **seulement là où il est SU** : dans le
 *   code qui traite une réponse dont on a lu l'en-tête `x-request-id`. Hors de cette
 *   portée, aucun `requestId` n'est attaché. Rien n'est deviné.
 *
 * Coût quand personne ne s'en sert : une variable à `undefined` et un test de référence
 * par `Pdu` (le provider n'est même pas branché tant que {@link installRequestIdProvider}
 * n'a pas été appelé).
 */

import Pdu from "../../syslog/Pdu";

/**
 * Identifiant de CE chargement de page. Alloué au premier appel seulement — une page
 * qui ne journalise jamais rien ne paie pas l'UUID.
 */
let _pageId: string | null = null;

/** Requête dont on traite la réponse, `undefined` hors de {@link withRequestId}. */
let _currentRequestId: string | undefined;

/** Restaure le provider d'origine au retrait, ou `null` s'il n'y en avait pas. */
let _previousProvider: (() => string | undefined) | null = null;
let _installed = false;

/**
 * Identifiant stable de ce chargement de page (UUID v4), généré à la demande.
 *
 * Il change à chaque rechargement — c'est voulu : il désigne une **session d'onglet**,
 * pas un utilisateur. Rien d'identifiant personnel ne doit y être mêlé.
 *
 * @returns l'identifiant de page, constant pour la durée du document.
 */
export function getPageId(): string {
  // `crypto.randomUUID()` en direct, et non le `generateId` du barrel client : ce
  // module est importé PAR le barrel, l'en faire dépendre fermerait un cycle. Un
  // appel de plateforme d'une ligne n'est pas une règle dupliquée.
  if (_pageId === null) _pageId = globalThis.crypto.randomUUID();
  return _pageId;
}

/**
 * Exécute `fn` en déclarant que ce qu'elle journalise appartient à la requête `requestId`.
 *
 * La portée est le **tick synchrone** de `fn`, et rien de plus : après un `await`, la
 * bulle est refermée. C'est une limite assumée, pas un défaut — le navigateur n'offre
 * aucun moyen de propager un contexte à travers l'asynchrone, et l'alternative (« le
 * dernier `requestId` vu ») fabriquerait de fausses corrélations.
 *
 * @example
 * ```ts
 * const res = await fetch("/api/orders");
 * const rid = res.headers.get("x-request-id") ?? undefined;
 * withRequestId(rid, () => {
 *   syslog.log("commande refusée", "ERROR", "checkout");
 * });
 * ```
 *
 * @param requestId - la requête connue, ou `undefined` pour n'en attacher aucune.
 * @param fn - le travail à exécuter dans cette portée.
 * @returns ce que `fn` renvoie.
 */
export function withRequestId<T>(
  requestId: string | undefined,
  fn: () => T,
): T {
  const previous = _currentRequestId;
  _currentRequestId = requestId;
  try {
    return fn();
  } finally {
    _currentRequestId = previous;
  }
}

/**
 * `requestId` de la portée courante, `undefined` en dehors de {@link withRequestId}.
 *
 * @returns l'identifiant de requête su à cet instant, jamais deviné.
 */
export function getCurrentRequestId(): string | undefined {
  return _currentRequestId;
}

/**
 * Branche {@link getCurrentRequestId} sur `Pdu.requestIdProvider`, de sorte que tout
 * `Pdu` créé dans une portée {@link withRequestId} porte son `requestId` — le même champ
 * que côté serveur, donc la même clé de recoupement, sans qu'aucun appelant ait à le
 * répéter.
 *
 * Idempotent. Le provider d'origine (il n'y en a pas côté navigateur, mais un test peut
 * en poser un) est restauré au retrait.
 *
 * @returns la fonction de retrait — à appeler au démontage.
 */
export function installRequestIdProvider(): () => void {
  if (_installed) return () => {};
  _installed = true;
  _previousProvider = Pdu.requestIdProvider;
  Pdu.requestIdProvider = getCurrentRequestId;
  return () => {
    if (!_installed) return;
    _installed = false;
    Pdu.requestIdProvider = _previousProvider;
    _previousProvider = null;
  };
}

/**
 * Remet le module à son état initial — réservé aux tests, qui doivent pouvoir repartir
 * d'une page « neuve » sans recharger un document.
 */
export function resetClientLogContext(): void {
  _pageId = null;
  _currentRequestId = undefined;
  if (_installed) {
    Pdu.requestIdProvider = _previousProvider;
    _previousProvider = null;
    _installed = false;
  }
}
