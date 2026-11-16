<% if (it.roleGuard) { %>import { route, controller, IsGranted } from "@nodefony/framework";
<% } else { %>import { route, controller } from "@nodefony/framework";
<% } %>import {
  RealtimeController,
  RealtimeChannel,
  RealtimeBroadcast,
} from "@nodefony/realtime";
import type { RealtimePublish } from "@nodefony/realtime";
import type { ContextType } from "@nodefony/http";
import { <%= it.channelConst %> } from "../service/<%= it.relayClass %>";

/**
 * <%= it.nameClass %> — les écritures de `<%= it.entityPascal %>`, en direct, par la
 * socket Nodefony.
 *
 * Généré par `nodefony create controller <%= it.pascal %> --kind realtime --entity <%= it.entityPascal %>`.
 *
 * Chaque création, retouche ou suppression faite par `<%= it.entityPascal %>Service` part
 * sur le canal `<%= it.channel %>`, quelle que soit la porte qui l'a demandée : la
 * route REST, la même route appelée par la socket, une commande CLI. La publication
 * n'est PAS écrite ici : c'est `<%= it.relayClass %>` qui écoute le service et publie
 * (`nodefony/service/<%= it.relayClass %>.ts`). Ce controller ne fait qu'OUVRIR le
 * canal aux clients.
 *
 * Pourquoi un relais plutôt qu'une ligne `publish` dans chaque action d'écriture :
 * une écriture qui passe par une autre porte que la route (une commande, un autre
 * service) serait muette, et personne ne verrait la ligne oubliée.
 *
 * Côté client (navigateur OU script Node — `nodefony/client` est isomorphe) :
 * ```ts
 * import { NodefonySocket } from "nodefony/client";
 * const socket = NodefonySocket.shared({ url: "<%= it.route %>/realtime" });
 * socket.on("<%= it.channel %>", (event) => {
 *   // { type: "created" | "updated", item } ou { type: "deleted", criteria, count }
 *   console.log(event);
 * });
 * await socket.connect();
 * socket.subscribe("<%= it.channel %>");
 * ```
 * (React : `useNodefonyChannelData("<%= it.channel %>")` de `nodefony/react`.)
 *
 * ⚠️ **Qui reçoit quoi.** Le canal diffuse la ligne ENTIÈRE, telle que
 * `GET` la rend, à quiconque passe la poignée de main de cette socket. Il doit
 * donc être au moins aussi fermé que la LECTURE de la ressource : si la liste de
 * `<%= it.entityPascal %>` est réservée à un rôle, réserve cette socket au même rôle
 * (`--role` à la génération, ou `@IsGranted` sur la classe).
 *
 * `@RealtimeBroadcast("<%= it.entityKebab %>:")` fait traverser le canal d'un pod à
 * l'autre quand un bus est configuré : l'écriture arrive sur un pod, l'abonné est
 * peut-être sur un autre. Sans bus, le décorateur ne coûte rien.
 */
@RealtimeBroadcast("<%= it.entityKebab %>:")
@controller("<%= it.route %>")
<% if (it.roleGuard) { %>// Habilitation exigée pour TOUTE la socket : le refus tombe à la poignée de
// main (403), avant qu'un seul abonnement soit possible.
@IsGranted("<%= it.role %>")
<% } %>class <%= it.nameClass %> extends RealtimeController {
  constructor(context: ContextType) {
    super("<%= it.kebab %>", context);
  }

  /** Handshake de la socket Nodefony — toutes les frames passent par ici. */
  @route("<%= it.kebab %>-realtime", {
    path: "/realtime",
    requirements: { methods: ["WEBSOCKET"] },
  })
  async realtime(message: string | Buffer | null): Promise<void> {
    this.handleRealtime(message);
  }

  /**
   * Le canal des écritures de `<%= it.entityPascal %>`, annoncé au client qui se
   * connecte. Il ne produit rien lui-même — le relais publie par le hub —, d'où un
   * nettoyage vide : rien n'est retenu par abonné.
   */
  @RealtimeChannel(<%= it.channelConst %>)
  events(_channel: string, _publish: RealtimePublish): () => void {
    return () => undefined;
  }
}

export default <%= it.nameClass %>;
