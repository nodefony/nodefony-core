import type {
  ContractServerEmit,
  EventNames,
  EventPayload,
  EventsMap,
  IRealtimeContract,
} from "nodefony";

/**
 * Publie une charge sur un canal (notification serveur→client) — forme LIBRE :
 * tout nom, toute charge objet. Sous un contrat, préférer {@link ContractRealtimePublish}.
 */
export type RealtimePublish = (channel: string, payload?: object) => void;

/**
 * Publie sur un canal DÉCLARÉ par le contrat `C` : le nom est l'un des canaux de
 * `serverToClient`, la charge est celle qu'il déclare. Une faute de frappe dans
 * le nom ou dans la charge ne compile pas.
 *
 * C'est le `publish` qu'une fabrique de canal déclare sous un contrat — méthode
 * `@RealtimeChannel` ou surcharge `createRealtimeChannel`. La fonction reçue à
 * l'exécution est la même qu'en forme libre ({@link RealtimePublish}) : seul le
 * compilateur voit la différence. La charge est un objet : le hub refuse un
 * scalaire à l'exécution (`isRealtimePayload`), le type le dit avant.
 *
 * @typeParam C - le contrat de l'application.
 *
 * @example
 * ```ts
 * @RealtimeChannel("chat:presence", { authenticated: true })
 * presence(_channel: string, publish: ContractRealtimePublish<ChatContract>) {
 *   publish("chat:presence", { online: 3 });
 *   return () => undefined;
 * }
 * ```
 */
export type ContractRealtimePublish<C extends IRealtimeContract> = <
  K extends EventNames<ContractServerEmit<C>>,
>(
  channel: K,
  payload: EventPayload<ContractServerEmit<C>, K> & object,
) => void;

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
 * Handler d'entrée TYPÉ par le contrat : `params` est ce que le client a émis sur
 * ce canal, lu par `Jsonify` ; `reply` pousse la charge que le serveur émet sur le
 * même canal. Les paramètres restent NON FIABLES : le type n'est pas une validation.
 *
 * Écrit en signature de MÉTHODE pour que ses paramètres se comparent de façon
 * bivariante : c'est ce qui permet à une table typée de remplacer la table
 * permissive de la base, que le contrôleur lit en `unknown` à l'exécution.
 */
export type TypedRealtimeInboundHandler<P, R> = {
  handle(params: P, reply: (payload: R) => void): void;
}["handle"];

/**
 * Table des entrées client d'un contrôleur : un handler par canal de `Listen`,
 * chacun facultatif — accepter une entrée reste un choix explicite, canal par
 * canal (par défaut, un client ne peut rien pousser). `Listen` non déclaré :
 * n'importe quel nom, `params: unknown`.
 */
export type RealtimeInboundHandlers<
  Listen extends EventsMap,
  Emit extends EventsMap,
> = {
  [K in EventNames<Listen>]?: TypedRealtimeInboundHandler<
    EventPayload<Listen, K>,
    K extends keyof Emit ? Emit[K] : unknown
  >;
};

/**
 * Handler d'action RPC tel que la table de `realtimeActions()` le range. Signature
 * de MÉTHODE (paramètre comparé de façon bivariante) : une table typée par le
 * contrat, dont chaque handler attend sa forme, remplace ainsi la table
 * permissive de la base.
 */
export type RealtimeActionHandler = {
  handle(params: unknown): unknown;
}["handle"];

/**
 * IRealtimeController — contrat d'un contrôleur temps réel SERVEUR (endpoint WS
 * JSON-RPC 2.0). Le protocole (discrimination, dispatch, actions, pending, pub/sub,
 * cleanup) est porté par {@link RealtimeController} via un `JsonRpcPeer` PAR
 * connexion ; le contrôleur concret ne fournit QUE ses providers de canaux.
 *
 * (Les hooks `realtimeActions()` / `realtimeChannels()` sont `protected` sur la base
 * — détail d'implémentation surchargeable, hors contrat public.)
 *
 * Côté client, le pendant n'est PAS un controller mais `NodefonySocket` — tous deux
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
