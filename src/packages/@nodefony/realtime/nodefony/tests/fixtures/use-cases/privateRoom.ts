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
import { getRoomMemberService } from "../service/RoomMemberService";

/**
 * Les salons : qui en est membre, et comment on en exclut. L'appartenance vit
 * en base — une ligne `RoomMember` (salon, compte) — derrière le service
 * d'entité généré par `create entity RoomMember`.
 */
@injectable()
export class RoomService extends Service {
  constructor(module: Module) {
    super("rooms", module.container ?? undefined, module.notificationsCenter);
  }

  /** Ce compte est-il membre du salon de ce canal (`room:<id>`) ? */
  async isMember(channel: string, user: string): Promise<boolean> {
    const room = RoomService.roomOf(channel);
    if (room === null) return false;
    return (await getRoomMemberService().findOne({ room, user })) !== null;
  }

  /** Exclure : retirer l'appartenance (l'admission dira non), PUIS couper ce qu'il reçoit déjà. */
  async exclude(channel: string, user: string): Promise<void> {
    const room = RoomService.roomOf(channel);
    if (room === null) return;
    await getRoomMemberService().delete({ room, user });
    getRealtimeHub().evictUser(channel, user); // ses onglets reçoivent `realtime:closed { reason: "evicted" }`
  }

  /** L'identifiant du salon d'un canal `room:<id>`, `null` hors de la famille. */
  static roomOf(channel: string): string | null {
    return channel.startsWith("room:") ? channel.slice("room:".length) : null;
  }
}

/**
 * Qui entre sur `room:*` : les membres du salon. Demandé UNE fois, au
 * `subscribe` (et à chaque page rechargée) : une requête en base y est normale.
 * `who.id` est l'identité posée par le serveur à l'ouverture, jamais un champ
 * du client.
 */
@injectable()
export class RoomAdmission extends Service implements IChannelAdmission {
  constructor(@Inject("RoomService") private readonly rooms: RoomService) {
    super("roomAdmission");
  }

  async allow(channel: string, who: ISubscriberIdentity): Promise<boolean> {
    return who.id !== null && (await this.rooms.isMember(channel, who.id));
  }
}

// La socket de CE contrôleur s'ouvre sur `/api/room/realtime` : le préfixe de la
// classe, puis le chemin de sa route WebSocket. Seuls les canaux déclarés ICI y
// sont servis — une socket ouverte ailleurs ne connaît pas `room:*`.
@controller("/api/room")
export class RoomRealtime extends RealtimeController {
  // Instancié PAR CONNEXION : ce qui est partagé entre membres vit dans le
  // service, que l'injecteur fournit.
  constructor(
    context: ContextType,
    @Inject("RoomService") private readonly rooms: RoomService,
  ) {
    super("RoomRealtime", context);
  }

  // Le point d'entrée : chaque trame de la socket arrive ici. `handleRealtime`
  // fait tout le protocole — accueil, identité de la connexion, abonnements,
  // entrées — et route vers les décorateurs ci-dessous. Rien d'autre à écrire.
  @route("room-realtime", {
    path: "/realtime",
    requirements: { methods: ["WEBSOCKET"] },
  })
  async realtime(message: string | Uint8Array | null): Promise<void> {
    this.handleRealtime(message);
  }

  // « CETTE personne a-t-elle droit à CE salon ? » : la classe d'admission tranche.
  @RealtimeChannel("room:*", { allow: RoomAdmission })
  room(): () => void {
    return () => {};
  }

  // Un canal décoré n'est servi que sous son nom exact : la famille l'est ici.
  override createRealtimeChannel(channel: string): (() => void) | null {
    return RoomService.roomOf(channel) === null ? null : () => {};
  }

  // Une entrée n'hérite PAS de la politique du canal : elle vérifie l'appartenance
  // elle-même, par le MÊME service que l'admission, et l'auteur vient de la connexion.
  @RealtimeInbound("room:send", { authenticated: true })
  async send(
    params: unknown,
    _reply: unknown,
    connection: IRealtimeConnection,
  ): Promise<void> {
    if (connection.userId === null || !RoomRealtime.isMessage(params)) return;
    if (!(await this.rooms.isMember(params.room, connection.userId))) return;
    getRealtimeHub().publish(params.room, {
      author: connection.userId,
      text: params.text.slice(0, 500),
    });
  }

  /** Ce qui arrive du réseau n'est pas fiable : un salon et un texte, ou rien. */
  private static isMessage(
    value: unknown,
  ): value is { room: string; text: string } {
    return (
      typeof value === "object" &&
      value !== null &&
      "room" in value &&
      "text" in value &&
      typeof value.room === "string" &&
      typeof value.text === "string"
    );
  }
}
