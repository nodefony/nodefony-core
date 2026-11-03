import { Inject, Module, Service, injectable } from "nodefony";
import type { IChannelAdmission, ISubscriberIdentity } from "nodefony";
import { controller, route } from "@nodefony/framework";
import type { ContextType } from "@nodefony/http";
import {
  RealtimeChannel,
  RealtimeController,
  RealtimeInbound,
  getRealtimeHub,
} from "../../../../index";
import type { IRealtimeConnection } from "../../../../index";

/**
 * Les parties : qui joue où. Une partie se remplit jusqu'à `SEATS` joueurs, la
 * suivante s'ouvre ensuite. UN exemplaire par serveur (en vrai, une table ou
 * un Redis partagé derrière ces mêmes méthodes).
 */
@injectable()
export class MatchmakingService extends Service {
  /** Joueurs par partie. */
  static readonly SEATS = 2;

  readonly #members = new Map<string, Set<string>>();
  #open: string | null = null;
  #count = 0;

  constructor(module: Module) {
    super(
      "matchmaking",
      module.container ?? undefined,
      module.notificationsCenter,
    );
  }

  /** Place un joueur : sa partie s'il en a une, sinon la partie ouverte, sinon une neuve. */
  join(player: string): string {
    for (const [match, members] of this.#members) {
      if (members.has(player)) return match;
    }
    const match = this.#open ?? `match:${++this.#count}`;
    const members = this.#members.get(match) ?? new Set<string>();
    members.add(player);
    this.#members.set(match, members);
    this.#open = members.size < MatchmakingService.SEATS ? match : null;
    return match;
  }

  /** Ce joueur appartient-il à cette partie ? */
  isMember(match: string, player: string): boolean {
    return this.#members.get(match)?.has(player) ?? false;
  }

  /** Cette partie existe-t-elle ? */
  exists(match: string): boolean {
    return this.#members.has(match);
  }
}

/**
 * Qui entre sur `match:*` : les joueurs de la partie, et eux seuls. Demandé au
 * premier abonnement ET à chaque reconnexion — l'appartenance vit dans le
 * service, pas sur la connexion qui vient de tomber.
 */
@injectable()
export class MatchAdmission extends Service implements IChannelAdmission {
  constructor(
    @Inject("MatchmakingService") private readonly matches: MatchmakingService,
  ) {
    super("matchAdmission");
  }

  allow(channel: string, who: ISubscriberIdentity): boolean {
    return who.id !== null && this.matches.isMember(channel, who.id);
  }
}

// Sa socket : `/api/match/realtime` (préfixe + route). Elle ne sert que les canaux déclarés ici.
@controller("/api/match")
export class MatchRealtime extends RealtimeController {
  // Instancié PAR CONNEXION : les parties vivent dans le service, le même pour tous.
  constructor(
    context: ContextType,
    @Inject("MatchmakingService") private readonly matches: MatchmakingService,
  ) {
    super("MatchRealtime", context);
  }

  // Le point d'entrée : `handleRealtime` fait tout le protocole et route vers les décorateurs.
  @route("match-realtime", {
    path: "/realtime",
    requirements: { methods: ["WEBSOCKET"] },
  })
  async realtime(message: string | Uint8Array | null): Promise<void> {
    this.handleRealtime(message);
  }

  @RealtimeChannel("match:*", { allow: MatchAdmission })
  match(): () => void {
    return () => {};
  }

  // Un canal décoré n'est servi que sous son nom exact : la famille l'est ici,
  // et seulement pour une partie qui existe.
  override createRealtimeChannel(channel: string): (() => void) | null {
    return this.matches.exists(channel) ? () => {} : null;
  }

  @RealtimeInbound("match:find", { authenticated: true })
  async find(
    _params: unknown,
    _reply: unknown,
    connection: IRealtimeConnection,
  ): Promise<void> {
    if (connection.userId === null) return;
    // 1. écrire l'appartenance là où `allow` la lit, 2. abonner d'office.
    const match = this.matches.join(connection.userId);
    await getRealtimeHub().subscribeConnection(match, connection);
  }
}
