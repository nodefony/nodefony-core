import type {
  ContractActionNames,
  ContractClientEmit,
  ContractServerActions,
  ContractServerEmit,
  ContractServerListen,
  ContractServerMethods,
  EventNames,
  IRealtimeContract,
  TypedRpcActionHandler,
} from "nodefony";
import { RealtimeController } from "./RealtimeController";

/**
 * Clé de l'étiquette de type qui relie une classe à son contrat. Déclaration
 * ambiante : aucun symbole n'existe à l'exécution, seul le compilateur la voit.
 */
declare const contractType: unique symbol;

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
 * Noms qu'un contrat déclare et qu'une politique peut garder : ses méthodes
 * serveur et les canaux de ses deux directions. Un canal déclaré par gabarit
 * (`user:${string}`) admet aussi son motif (`user:*`). Direction non déclarée :
 * tout nom.
 */
export type ContractPolicyNames<C extends IRealtimeContract> =
  | ContractActionNames<ContractServerMethods<C>>
  | EventNames<ContractServerEmit<C>>
  | EventNames<ContractClientEmit<C>>;

/**
 * Le contrat qu'une classe de contrôleur implémente, lu sur son étiquette de
 * type ; `never` pour un contrôleur sans contrat.
 */
export type RealtimeContractOf<T> = T extends abstract new (
  ...args: never[]
) => { readonly [contractType]?: infer C }
  ? unknown extends C
    ? never
    : C extends IRealtimeContract
      ? C
      : never
  : never;

/**
 * Base d'un contrôleur qui IMPLÉMENTE un contrat temps réel — la porte du
 * serveur. Le contrat s'écrit UNE fois, sur `extends` ; la direction du serveur
 * en est dérivée (il émet `serverToClient`, écoute `clientToServer`, appelle
 * `clientMethods`) et il DOIT servir chaque méthode de `serverMethods`.
 *
 * `realtimeActions()` y devient abstraite et typée par le contrat : c'est la
 * seule construction qui fait d'une méthode OUBLIÉE une erreur de compilation —
 * un décorateur ne voit jamais la classe entière. Un contrat sans
 * `serverMethods` la satisfait par `return {}`. Les entrées client
 * (`realtimeInbound()`) restent facultatives canal par canal : accepter une
 * entrée est une permission, pas une promesse. Les politiques d'accès se posent
 * sur la classe par `@RealtimePolicy`, qui lit le contrat sur cette classe.
 *
 * Le fichier du contrat, fait de types seuls, est partagé avec le navigateur, qui
 * entre par `NodefonySocket.fromContract<C>()`.
 *
 * @typeParam C - le contrat de l'application.
 *
 * @example
 * ```ts
 * @RealtimePolicy({ "chat:send": { roles: ["ROLE_USER"] } })
 * class ChatRt extends ContractRealtimeController<ChatContract> {
 *   protected realtimeActions() {
 *     return { "chat:send": (p: { text: string }) => ({ id: this.store(p.text) }) };
 *   }
 * }
 * ```
 */
export abstract class ContractRealtimeController<
  C extends IRealtimeContract,
> extends RealtimeController<
  ContractServerEmit<C>,
  ContractServerActions<C>,
  ContractServerListen<C>
> {
  /**
   * Étiquette de TYPE : relie la classe à son contrat pour que `@RealtimePolicy`
   * le retrouve. `declare` — aucun champ n'existe à l'exécution.
   */
  declare readonly [contractType]?: C;

  /**
   * Les méthodes du contrat servies par ce contrôleur — toutes, et par cette
   * table SEULE : une action servie ici ne se décore pas en plus de
   * `@RealtimeAction` (handler fabriqué puis écrasé à chaque connexion). Sa
   * politique se pose sur la classe, par `@RealtimePolicy`.
   *
   * Appelée à chaque connexion. Des handlers qui n'ont pas besoin de `this` se
   * rangent dans une table CONSTANTE du module, rendue telle quelle : aucune
   * allocation par connexion.
   */
  protected abstract override realtimeActions(): RealtimeMethodHandlers<C>;

  /** Canaux annoncés au handshake, contraints aux noms de `serverToClient`. */
  protected override realtimeChannels(): EventNames<ContractServerEmit<C>>[] {
    return [];
  }
}
