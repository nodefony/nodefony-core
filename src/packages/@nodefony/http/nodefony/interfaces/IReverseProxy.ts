/**
 * Origine d'un amont relayé : `scheme://hôte[:port]`, sans chemin.
 *
 * Une fonction quand l'origine n'est connue qu'à l'exécution (un serveur
 * enfant qui choisit son port au démarrage) : elle est rappelée à chaque
 * requête, et `undefined` signifie « l'amont n'est pas prêt » — la requête
 * reçoit `503` (`Retry-After: 1`), l'upgrade WebSocket `503` avant tout `101` :
 * le préfixe appartient à l'amont, le routage n'a rien à y répondre.
 */
export type ProxyTarget = string | (() => string | undefined);

/**
 * Réglages d'un montage du proxy inverse (`ReverseProxy.mount`).
 *
 * Les défauts sont ceux d'un relais sans surprise : toutes les méthodes, le
 * chemin transmis tel quel, l'en-tête `Host` réécrit sur la cible, aucun
 * en-tête retiré au-delà des en-têtes de connexion, certificat de la cible
 * vérifié.
 */
export interface IProxyMountOptions {
  /** Origine de l'amont (cf {@link ProxyTarget}). */
  target: ProxyTarget;
  /**
   * Méthodes relayées (majuscules). Une autre méthode n'est PAS relayée : la
   * requête poursuit jusqu'au routage. Absent = toutes.
   */
  methods?: readonly string[] | undefined;
  /**
   * Relaie aussi l'upgrade WebSocket du préfixe. Sans ce drapeau, un upgrade
   * sur le préfixe reste au serveur WebSocket de Nodefony.
   */
  websocket?: boolean | undefined;
  /**
   * Retire le préfixe avant de transmettre le chemin (`/svc/a` → `/a`).
   * Défaut `false` : l'amont reçoit le chemin complet — c'est le cas d'un
   * serveur qui connaît déjà son préfixe (Vite et son `base`).
   */
  stripPrefix?: boolean | undefined;
  /**
   * Garde l'en-tête `Host` du client au lieu de le réécrire sur la cible.
   * Défaut `false` : un amont qui filtre les noms d'hôte (Vite et son
   * `allowedHosts`) reçoit le sien, et le nom d'origine part dans
   * `X-Forwarded-Host`.
   */
  preserveHost?: boolean | undefined;
  /**
   * En-têtes de requête à ne pas transmettre (insensible à la casse) — ce
   * dont l'amont n'a pas l'usage ne doit pas lui parvenir (`cookie`,
   * `authorization` vers un serveur de sources, par exemple).
   */
  stripHeaders?: readonly string[] | undefined;
  /**
   * Délai d'inactivité de l'échange avec l'amont, en ms. Dépassé avant la
   * réponse : 504. Absent = `proxy.timeoutMs` de la configuration (30 s par
   * défaut). Ne s'applique pas à un WebSocket établi.
   */
  timeoutMs?: number | undefined;
  /**
   * Vérifie le certificat d'une cible `https:`. Défaut `true` — `false` n'est
   * ACCEPTÉ que vers la boucle locale (refus au montage sinon).
   */
  secure?: boolean | undefined;
}

/** Un montage tel que le proxy le garde : préfixe normalisé + réglages. */
export interface IProxyMount extends IProxyMountOptions {
  /** Préfixe d'URL normalisé (`/` en tête et en fin). */
  readonly prefix: string;
}
