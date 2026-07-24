import { route, controller } from "@nodefony/framework";
import {
  RealtimeController,
  RealtimeChannel,
  RealtimeAction,
} from "@nodefony/realtime";
import type { RealtimePublish } from "@nodefony/realtime";
import type { ContextType } from "@nodefony/http";

/**
 * <%= it.nameClass %> — endpoint temps réel de la socket Nodefony (JSON-RPC
 * 2.0). La base {@link RealtimeController} porte TOUT le protocole (handshake,
 * pub/sub par canal, actions requête→réponse, cleanup, fan-out par le hub) :
 * cette classe ne déclare QUE son métier — ses canaux et ses actions, par
 * DÉCORATEURS ({@link RealtimeChannel} / {@link RealtimeAction}) qui posent au
 * passage la politique d'autorisation de chaque nom.
 *
 * Généré par `nodefony create controller --kind realtime`.
 *
 * Côté client (navigateur OU script Node — la façade est isomorphe, le
 * subpath `nodefony/client` est sa porte explicite) :
 * ```ts
 * import { RealtimeClient } from "nodefony/client";
 * // URL RELATIVE, résolue contre la page (https → wss automatique) ;
 * // `.shared()` = UNE socket par URL, partagée par toute la page.
 * const socket = RealtimeClient.shared({ url: "<%= it.route %>/realtime" });
 * socket.on("<%= it.channel %>:ticker", (msg) => console.log("tick", msg));
 * await socket.connect();
 * socket.subscribe("<%= it.channel %>:ticker");        // flux serveur → client
 * const pong = await socket.request("<%= it.channel %>:ping", {}); // RPC aller-retour
 * ```
 * (React : `NodefonyProvider` + hooks `nodefony/react` — `useNodefony()`,
 * `useNodefonyChannelData()` — cf la vitrine `frontend/src/` d'une app complete.)
 */
@controller("<%= it.route %>")
class <%= it.nameClass %> extends RealtimeController {
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
   * Action RPC (requête→réponse) — liveness + round-trip mesurable client.
   *
   * ⚠ Une action SANS `policy` est FERMÉE par défaut (connexion authentifiée
   * exigée) : une action est une méthode que le pair APPELLE et qui AGIT.
   * Celle-ci est en LECTURE pure → ouverte à l'anonyme, et on l'ÉCRIT
   * (`authenticated: false`) pour que l'ouverture soit un choix visible.
   */
  @RealtimeAction("<%= it.channel %>:ping", { authenticated: false })
  ping() {
    return { pong: true, ts: Date.now(), pid: process.pid };
  }

<% if (it.hasSecurity) { %>  /**
   * Action PROTÉGÉE par rôle (policy inline) : vue d'exploitation réservée —
   * sans `ROLE_ADMIN`, le voter refuse la frame AVANT d'entrer ici et
   * l'appelant reçoit une erreur JSON-RPC générique, jamais le détail
   * (Zero Trust). En dev, le compte seedé `admin/admin` a le rôle.
   */
  @RealtimeAction("<%= it.channel %>:snapshot", { roles: ["ROLE_ADMIN"] })
  snapshot() {
    return {
      pid: process.pid,
      rssBytes: process.memoryUsage().rss,
      ts: Date.now(),
    };
  }

<% } %>  /**
   * Canal démo : 1 tick/s TANT QU'au moins un client est abonné. Annoncé au
   * `realtime:welcome` par le décorateur (rien d'autre à déclarer). Le provider
   * est créé au 1ᵉʳ `subscribe` et son dispose est GARANTI au dernier
   * `unsubscribe`/close (1 provider par canal par pod, fan-out par le hub) —
   * zéro coût quand personne n'écoute.
   *
   * Sans `policy`, un CANAL reste LIBRE (contrairement à une action) : un flux
   * se lit, une action agit. Pour le fermer : `@RealtimeChannel(name, { roles })`.
   */
  @RealtimeChannel("<%= it.channel %>:ticker")
  ticker(channel: string, publish: RealtimePublish): () => void {
    let n = 0;
    const timer = setInterval(() => {
      publish(channel, { n: ++n, ts: Date.now(), pid: process.pid });
    }, 1000);
    timer.unref();
    return () => clearInterval(timer);
  }
}

export default <%= it.nameClass %>;
