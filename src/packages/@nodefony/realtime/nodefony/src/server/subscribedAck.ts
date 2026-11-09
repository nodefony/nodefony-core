/**
 * Trame d'acquittement d'abonnement — `realtime:subscribed`, écrite d'un bloc.
 *
 * Tout ce qui précède le nom du canal ne dépend que du protocole : il est
 * calculé une fois au chargement du module. Seul le canal se sérialise par
 * trame. On évite ainsi l'enveloppe allouée et le `JSON.stringify` générique
 * de `JsonRpcPeer.notify` — mesuré à ~0,5 µs par acquittement, soit l'essentiel
 * du surcoût d'un `subscribe` acquitté.
 *
 * ⚠️ C'est une SECONDE écriture du format de notification : son égalité avec
 * `JsonRpcPeer.buildNotification` est verrouillée par `subscribedAck.test.ts`,
 * sur des noms de canal hostiles (guillemets, barres obliques inverses,
 * caractères de contrôle, Unicode).
 *
 * @internal
 */

/** Le préfixe invariant de la trame, jusqu'à la valeur `channel` exclue. */
const SUBSCRIBED_FRAME_PREFIX =
  '{"jsonrpc":"2.0","method":"realtime:subscribed","params":{"channel":';

/**
 * Sérialise la notification `realtime:subscribed { channel }`.
 *
 * Connexion TEXTE seulement : sous codec binaire, l'accusé passe par
 * `peer.notify` (`RealtimeController.ts#RealtimeController.acknowledgeSubscription`).
 *
 * @param channel - le canal acquitté (entrée réseau : échappé par `JSON.stringify`).
 * @returns la trame JSON-RPC 2.0 prête à écrire sur le transport.
 */
export function subscribedAckFrame(channel: string): string {
  return SUBSCRIBED_FRAME_PREFIX + JSON.stringify(channel) + "}}";
}

/**
 * Sérialise `realtime:subscribed { channel, imposed: true }` — l'acquittement d'un abonnement imposé par le serveur.
 *
 * @param channel - le canal imposé (échappé par `JSON.stringify`).
 * @returns la trame JSON-RPC 2.0 prête à écrire sur le transport.
 */
export function imposedSubscribedAckFrame(channel: string): string {
  return (
    SUBSCRIBED_FRAME_PREFIX + JSON.stringify(channel) + ',"imposed":true}}'
  );
}
