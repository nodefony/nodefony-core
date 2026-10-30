import type {
  ContractActionNames,
  ContractServerActions,
  ContractServerEmit,
  ContractServerListen,
  ContractServerMethods,
  EventNames,
  IRealtimeContract,
  TypedRpcActionHandler,
} from "nodefony";
import { RealtimeController } from "./RealtimeController";
import { RealtimeAction } from "../../decorators/realtimeDecorators";
import type { IChannelPolicy } from "../../interfaces/IChannelPolicy";

/**
 * Table COMPLÈTE des méthodes que le serveur doit au contrat : une entrée par nom
 * de `serverMethods`, chacune recevant ses paramètres lus par `Jsonify` et rendant
 * le résultat déclaré. Une méthode oubliée, un nom hors contrat ou une forme
 * fausse ne compilent pas.
 */
export type RealtimeMethodHandlers<C extends IRealtimeContract> = {
  [K in ContractActionNames<ContractServerMethods<C>>]: TypedRpcActionHandler<
    ContractServerMethods<C>,
    K
  >;
};

/**
 * Décorateur `@RealtimeAction` contraint par le contrat : le nom appartient à
 * `serverMethods`, et la méthode décorée doit accepter ses paramètres et rendre
 * son résultat. Il pose aussi la politique d'accès de la méthode, ce que la table
 * de `realtimeActions()` ne sait pas porter.
 */
export type ContractRealtimeAction<C extends IRealtimeContract> = <
  K extends ContractActionNames<ContractServerMethods<C>>,
>(
  method: K,
  policy?: IChannelPolicy,
) => <M extends TypedRpcActionHandler<ContractServerMethods<C>, K>>(
  target: object,
  propertyKey: string | symbol,
  descriptor: TypedPropertyDescriptor<M>,
) => void;

/**
 * Base d'un contrôleur qui IMPLÉMENTE un contrat temps réel : la direction du
 * serveur en est dérivée (il émet `serverToClient`, écoute `clientToServer`,
 * appelle `clientMethods`) et il DOIT servir chaque méthode de `serverMethods`.
 *
 * `realtimeActions()` y devient abstraite et typée par le contrat : c'est la
 * seule construction qui fait d'une méthode OUBLIÉE une erreur de compilation —
 * un décorateur ne voit jamais la classe entière. Un contrat sans
 * `serverMethods` la satisfait par `return {}`. Les entrées client
 * (`realtimeInbound()`) restent facultatives canal par canal : accepter une
 * entrée est une permission, pas une promesse.
 *
 * Ne s'étend pas directement : `implementRealtimeContract<C>().Controller`.
 *
 * @typeParam C - le contrat de l'application.
 */
export abstract class ContractRealtimeController<
  C extends IRealtimeContract,
> extends RealtimeController<
  ContractServerEmit<C>,
  ContractServerActions<C>,
  ContractServerListen<C>
> {
  /**
   * Les méthodes du contrat servies par ce contrôleur — toutes. Une méthode qui
   * porte aussi `@RealtimeAction` (pour sa politique) y délègue :
   * `"chat:send": (p) => this.send(p)`.
   */
  protected abstract override realtimeActions(): RealtimeMethodHandlers<C>;

  /** Canaux annoncés au handshake, contraints aux noms de `serverToClient`. */
  protected override realtimeChannels(): EventNames<ContractServerEmit<C>>[] {
    return [];
  }
}

/** Ce que rend {@link implementRealtimeContract} : les deux outils du serveur. */
export interface IRealtimeContractImplementation<C extends IRealtimeContract> {
  /** Base du contrôleur, typée par le contrat. */
  readonly Controller: typeof ContractRealtimeController<C>;
  /** `@RealtimeAction` contraint aux méthodes du contrat. */
  readonly RealtimeAction: ContractRealtimeAction<C>;
}

/**
 * La porte du serveur : les outils qui implémentent le contrat `C` côté serveur.
 *
 * Le contrat est un type, déclaré une fois dans un fichier partagé ; le navigateur
 * entre par `NodefonySocket.fromContract<C>()`, le serveur par cette fonction. Elle
 * ne rend que la base de contrôleur et le décorateur, jamais une socket : le
 * fichier partagé n'importe ainsi aucun code serveur. Une allocation, au
 * chargement du module qui l'appelle.
 *
 * @typeParam C - le contrat de l'application.
 * @returns `{ Controller, RealtimeAction }` typés par `C`.
 *
 * @example
 * ```ts
 * const chat = implementRealtimeContract<ChatContract>();
 * class ChatRt extends chat.Controller {
 *   protected realtimeActions() {
 *     return { "chat:send": (p) => this.send(p) };
 *   }
 *   @chat.RealtimeAction("chat:send", { roles: ["ROLE_USER"] })
 *   send(p: { text: string }): { id: string } { … }
 * }
 * ```
 */
export function implementRealtimeContract<
  C extends IRealtimeContract,
>(): IRealtimeContractImplementation<C> {
  return {
    Controller: ContractRealtimeController<C>,
    RealtimeAction,
  };
}
