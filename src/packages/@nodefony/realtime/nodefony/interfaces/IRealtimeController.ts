/** Publie une charge sur un canal (notification serveur→client). */
export type RealtimePublish = (channel: string, payload: unknown) => void;

/**
 * Handler d'un message ENTRANT sur un canal full-duplex (client → serveur). C'est le
 * seam des backings entrants (SIP, bridge) : le client `publish(channel, payload)` ; si
 * le contrôleur a déclaré ce canal dans `realtimeInbound()`, le handler est appelé.
 *
 * - `params` = la charge du client. **NON FIABLE** (Zero Trust) : le handler DOIT la
 *   valider (origine non authentifiée au niveau transport).
 * - `reply` = pousse une charge serveur→client sur le MÊME canal, vers CETTE connexion
 *   uniquement (ex. réponse SIP). Per-connexion (≠ fan-out).
 *
 * Par défaut aucun canal n'accepte d'entrée (sûr) : un contrôleur opte explicitement.
 */
export type RealtimeInboundHandler = (
  params: unknown,
  reply: (payload: unknown) => void,
) => void;

/**
 * IRealtimeController — contrat d'un contrôleur temps réel SERVEUR (endpoint WS
 * JSON-RPC 2.0). Le protocole (discrimination, dispatch, actions, pending, pub/sub,
 * cleanup) est porté par {@link RealtimeController} via un `JsonRpcPeer` PAR
 * connexion ; le contrôleur concret ne fournit QUE ses providers de canaux.
 *
 * (Les hooks `realtimeActions()` / `realtimeChannels()` sont `protected` sur la base
 * — détail d'implémentation surchargeable, hors contrat public.)
 *
 * Côté client, le pendant n'est PAS un controller mais `RealtimeClient` — tous deux
 * composent le même peer ; cf vision « la socket Nodefony ».
 */
export interface IRealtimeController {
  /**
   * Crée le provider d'un canal au `subscribe` (démarre listener/ticker, pousse via
   * `publish`) et renvoie son `dispose` (appelé au `unsubscribe` ET à la fermeture).
   * `null` si le canal est inconnu.
   */
  createRealtimeChannel(
    channel: string,
    publish: RealtimePublish,
  ): (() => void) | null;
}

export default IRealtimeController;
