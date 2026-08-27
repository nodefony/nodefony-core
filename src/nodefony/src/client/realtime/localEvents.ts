/**
 * localEvents — **noms des événements LOCAUX du client temps réel**.
 *
 * Ces six noms ne voyagent jamais sur le fil : ils ne servent qu'à propager, dans
 * la page, ce que le client vient d'apprendre (changement d'état de connexion,
 * identité résolue au welcome, échantillon de statistiques, notice normalisée,
 * refus de canal). Ils partagent la table de `on()`/`off()` avec les canaux
 * réseau ; le double soulignement est ce qui les en distingue.
 *
 * **La table est la source unique**, exactement pour la même raison que
 * {@link PLATFORM_CHANNELS} l'est pour les canaux réseau : une chaîne recopiée
 * dans un écran est une chaîne qui survivra au renommage suivant. Celle-ci avait
 * déjà divergé — `"__state__"` était écrit en clair dans les trois gabarits
 * d'application, dans la barre de debug et dans la console d'administration,
 * sans qu'aucune constante ne l'exporte.
 *
 * Un consommateur n'a d'ailleurs pas à les connaître : `onState`, `onIdentity`,
 * `onStats`, `onNotice`, `onDenied` et `onReconnect` sont les portes publiques. La table existe
 * pour les implémentations (le client lui-même, ses observateurs agnostiques) et
 * pour un test qui veut se brancher au plus bas niveau.
 *
 * Pur et isomorphe (aucun import, aucune allocation).
 */

/**
 * Événements locaux du {@link RealtimeClient} — jamais émis ni reçus par le réseau.
 *
 * @see {@link RealtimeClient.onState} · {@link RealtimeClient.onIdentity} ·
 *   {@link RealtimeClient.onStats} · {@link RealtimeClient.onNotice} ·
 *   {@link RealtimeClient.onDenied} — les portes publiques à préférer partout.
 */
export const LOCAL_EVENTS = {
  /** État de la connexion (`"connected" | "reconnecting" | …`), à chaque transition. */
  state: "__state__",
  /** Identité résolue par le serveur au welcome ; `null` après un `disconnect()`. */
  identity: "__identity__",
  /** Tick d'échantillonnage des statistiques par canal (1×/s), sans charge utile. */
  stats: "__stats__",
  /** Notice normalisée (criticité temps réel interprétée). */
  notice: "__notice__",
  /** Refus d'un canal poussé par le serveur (`realtime:denied`). */
  denied: "__denied__",
  /** Tentative de reconnexion programmée (numéro d'essai, délai, échéance). */
  reconnect: "__reconnect__",
} as const;

/** Un des noms d'événement local de la table {@link LOCAL_EVENTS}. */
export type LocalEvent = (typeof LOCAL_EVENTS)[keyof typeof LOCAL_EVENTS];

/**
 * Vrai si `event` est un événement local du client (jamais un canal réseau).
 *
 * Sert aux couches qui inspectent la table des abonnements — une barre de debug,
 * un inventaire de canaux — et qui doivent écarter ce qui n'est pas du trafic.
 */
export function isLocalEvent(event: string): event is LocalEvent {
  return (
    event === LOCAL_EVENTS.state ||
    event === LOCAL_EVENTS.identity ||
    event === LOCAL_EVENTS.stats ||
    event === LOCAL_EVENTS.notice ||
    event === LOCAL_EVENTS.denied ||
    event === LOCAL_EVENTS.reconnect
  );
}
