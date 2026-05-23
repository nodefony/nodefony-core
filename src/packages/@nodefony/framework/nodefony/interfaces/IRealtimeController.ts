/** Publie une charge sur un canal (notification serveur→client). */
export type RealtimePublish = (channel: string, payload: unknown) => void;

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
