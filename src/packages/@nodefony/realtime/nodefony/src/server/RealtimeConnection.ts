import type { ISubscriberIdentity, RealtimeClosedReason } from "nodefony";
import type { ChannelFrame } from "./RealtimeHub";
import type { IRealtimeConnection } from "../../interfaces/IRealtimeConnection";

/**
 * Ce que la poignée d'une connexion demande au contrôleur qui la sert — imposer
 * un abonnement, y mettre fin. Implémenté par `RealtimeController`, une fois par
 * connexion.
 */
export interface IRealtimeConnectionHost {
  /** Lance l'abonnement imposé à `channel` ; le verdict passe par {@link RealtimeConnection.settleImposed}. */
  impose(channel: string): void;
  /**
   * Met fin à l'abonnement de cette connexion à `channel` (hub ET état de la
   * connexion) et le lui notifie (`realtime:closed`).
   *
   * @returns `false` si la connexion n'est pas abonnée à ce canal.
   */
  end(channel: string, reason: RealtimeClosedReason): boolean;
  /** Écrit une trame partagée, encodée pour le codec de cette connexion. */
  send(frame: ChannelFrame): void;
}

/** Un abonnement imposé qui attend son verdict (politique fixe, puis `allow`). */
interface IImposedSubscription {
  /** Les appelants de `subscribeConnection` à prévenir — plusieurs si le même canal est imposé deux fois. */
  readonly settle: ((subscribed: boolean) => void)[];
  /**
   * Le client a demandé ce même canal pendant l'attente : un refus lui est
   * alors dû (`realtime:denied`), comme à tout `subscribe`.
   */
  clientAsked: boolean;
}

/**
 * Poignée d'une connexion temps réel servie par ce processus — implémente {@link IRealtimeConnection}.
 *
 * Créée paresseusement par le contrôleur, au premier abonnement ou à la
 * première trame entrante de la connexion (jamais au welcome : une connexion
 * qui ne fait ni l'un ni l'autre n'en paie aucune). Fermée au `onFinish` de la
 * socket : les gestes du hub rendent alors `false`, et les abonnements imposés
 * en attente se soldent par un refus.
 *
 * @internal Le type public est {@link IRealtimeConnection} ; seuls le hub et le
 * contrôleur appellent les méthodes de cette classe.
 */
export class RealtimeConnection implements IRealtimeConnection {
  readonly #host: IRealtimeConnectionHost;
  // Lue à la première demande seulement : un abonnement sans `allow` ne lit
  // pas l'identité, et la poignée ne doit pas l'y obliger.
  #identify: (() => ISubscriberIdentity | null) | null;
  #userId: string | null = null;
  #account = false;
  #open = true;
  // Abonnements imposés en attente de verdict — `null` tant qu'aucun.
  #imposing: Map<string, IImposedSubscription> | null = null;

  /**
   * @param host - le contrôleur qui sert la connexion.
   * @param identify - lit l'identité d'admission, figée au handshake ; appelé
   *   au plus une fois.
   */
  constructor(
    host: IRealtimeConnectionHost,
    identify: () => ISubscriberIdentity | null,
  ) {
    this.#host = host;
    this.#identify = identify;
  }

  /** Lit l'identité au premier besoin, une fois. */
  #resolveIdentity(): void {
    const identify = this.#identify;
    if (identify === null) return;
    this.#identify = null;
    const identity = identify();
    this.#userId = identity?.id ?? null;
    this.#account = identity?.account === true;
  }

  /** Identifiant du compte connecté ; `null` pour l'anonyme. */
  get userId(): string | null {
    this.#resolveIdentity();
    return this.#userId;
  }

  /**
   * `userId` désigne-t-il un compte LOCAL ? `false` pour l'anonyme et l'appelant
   * machine sans compte (`<émetteur>#<sujet>`) — ceux que la présence compte sans
   * les nommer (ADR-0025 P3).
   */
  get account(): boolean {
    this.#resolveIdentity();
    return this.#account;
  }

  /**
   * Écrit une trame PARTAGÉE (encodée une fois par codec) sur cette connexion — rien si la socket est fermée.
   *
   * Voie des notifications du protocole qui visent les membres d'un canal (la
   * présence) : elles ne passent pas par le sink du canal, qui les livrerait
   * sous le nom du canal.
   */
  deliver(frame: ChannelFrame): void {
    if (this.#open) this.#host.send(frame);
  }

  /** `false` une fois la socket fermée. */
  get open(): boolean {
    return this.#open;
  }

  /**
   * Impose l'abonnement à `channel` — même politique, même `allow` qu'un `subscribe` du client.
   *
   * @returns une promesse résolue à `true` une fois l'abonnement acquitté, à
   *   `false` s'il est refusé, si la connexion se ferme avant, ou si le client
   *   s'en désabonne pendant l'attente.
   */
  impose(channel: string): Promise<boolean> {
    if (!this.#open) return Promise.resolve(false);
    const imposing = (this.#imposing ??= new Map<
      string,
      IImposedSubscription
    >());
    const pending = imposing.get(channel);
    if (pending !== undefined) {
      return new Promise((resolve) => {
        pending.settle.push(resolve);
      });
    }
    const entry: IImposedSubscription = { settle: [], clientAsked: false };
    const verdict = new Promise<boolean>((resolve) => {
      entry.settle.push(resolve);
    });
    imposing.set(channel, entry);
    this.#host.impose(channel);
    return verdict;
  }

  /**
   * Met fin à l'abonnement de cette connexion à `channel`.
   *
   * @returns `false` si la connexion est fermée ou n'est pas abonnée au canal.
   */
  end(channel: string, reason: RealtimeClosedReason): boolean {
    return this.#open && this.#host.end(channel, reason);
  }

  /** Un abonnement imposé à `channel` attend-il son verdict ? */
  isImposing(channel: string): boolean {
    return this.#imposing?.has(channel) === true;
  }

  /** Le client demande `channel` pendant l'attente de son imposition : un refus lui sera dû. */
  markClientAsked(channel: string): void {
    const entry = this.#imposing?.get(channel);
    if (entry !== undefined) entry.clientAsked = true;
  }

  /**
   * Solde l'abonnement imposé à `channel`, s'il y en a un.
   *
   * @returns `true` si le refus doit AUSSI être rendu au client (il avait
   *   demandé ce canal) ou s'il n'y avait pas d'imposition en cours — dans les
   *   deux cas l'appelant suit son chemin habituel ; `false` si le refus
   *   n'appartient qu'à l'appelant serveur.
   */
  settleImposed(channel: string, subscribed: boolean): boolean {
    const imposing = this.#imposing;
    const entry = imposing?.get(channel);
    if (imposing === null || entry === undefined) return true;
    imposing.delete(channel);
    if (imposing.size === 0) this.#imposing = null;
    for (const settle of entry.settle) settle(subscribed);
    return entry.clientAsked;
  }

  /** Fermeture de la socket : la poignée ne désigne plus rien, les impositions en attente échouent. */
  close(): void {
    this.#open = false;
    const imposing = this.#imposing;
    if (imposing === null) return;
    this.#imposing = null;
    for (const entry of imposing.values())
      for (const settle of entry.settle) settle(false);
  }
}
