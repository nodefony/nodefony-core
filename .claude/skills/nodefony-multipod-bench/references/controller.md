# Le controller du banc

Endpoint temps réel minimal : un canal **broadcast** (sinon rien ne traverse le bus), une
route de publication, une route de rafale pour la charge, une sonde qui expose le compteur
d'ingress refusés. Le tout pilotable au `curl`, sans navigateur.

Coller dans `modules/chat/nodefony/controllers/ChatController.ts` de chaque application du
banc — identique partout : ce sont les **variables de lancement** qui distinguent les pods
(`NF_POD_NAME`, ports, présence ou non de `NF_REALTIME_BACKPLANE_SECRET`).

```ts
import { route, controller } from "@nodefony/framework";
import {
  RealtimeController,
  RealtimeBroadcast,
  RealtimeChannel,
  RealtimeInbound,
  getRealtimeHub,
} from "@nodefony/realtime";
import type { RealtimePublish } from "@nodefony/realtime";
import type { RpcActionHandler } from "nodefony";
import type { ContextType } from "@nodefony/http";

/**
 * Banc F83 — endpoint temps réel avec un canal **broadcast** (`chat:`), donc
 * propagé cross-pod par le backplane, et une route HTTP de publication pour
 * pousser depuis l'extérieur (curl) sans navigateur.
 */
@RealtimeBroadcast("chat:")
@controller("/api/chat")
class ChatController extends RealtimeController {
  constructor(context: ContextType) {
    super("chat", context);
  }

  @route("chat-realtime", {
    path: "/realtime",
    requirements: { methods: ["WEBSOCKET"] },
  })
  async realtime(message: string | Buffer | null): Promise<void> {
    this.handleRealtime(message);
  }

  /** Publication légitime depuis l'extérieur : `curl -X POST …/api/chat/say`. */
  @route("chat-say", { path: "/say", requirements: { methods: ["POST"] } })
  async say(): Promise<unknown> {
    // Le corps se lit par `this.body` (le corps parsé) — PAS par
    // `context.request.body`, qui n'existait pas et rendait `undefined` en
    // silence : le banc publiait toujours "hello" sans que rien ne le dise.
    const body = (this.body ?? {}) as { msg?: string };
    const payload = {
      msg: body.msg ?? "hello",
      from: process.env.NF_POD_NAME ?? String(process.pid),
      ts: Date.now(),
    };
    getRealtimeHub().publish("chat:room1", payload);
    return { published: payload };
  }

  /** Rafale de N publications (banc de charge cross-pod). */
  @route("chat-burst", { path: "/burst", requirements: { methods: ["GET"] } })
  async burst(): Promise<unknown> {
    // La query vit sur la REQUÊTE, exposée par le controller (`this.query`) :
    // un `context.query` inexistant retombe silencieusement sur la valeur par
    // défaut — la rafale paraît lancée, elle ne publie que 100 messages.
    // `this.query` = paramètres d'URL seuls (le corps reste dans `this.body`).
    const q = this.query as Record<string, unknown> | undefined;
    const n = Number(q?.n ?? 100);
    // Taille de charge (octets de remplissage). Un message de banc minuscule
    // (~50 o) ne ressemble à aucune charge applicative et masque tout ce qui
    // dépend de la TAILLE : sérialisation, compression, découpage réseau.
    const size = Number(q?.size ?? 0);
    const pad = size > 0 ? "x".repeat(size) : undefined;
    const hub = getRealtimeHub();
    const started = Date.now();
    for (let i = 0; i < n; i++) {
      hub.publish("chat:room1", {
        seq: i,
        ts: Date.now(),
        from: process.env.NF_POD_NAME,
        pad,
      });
    }
    return { published: n, elapsedMs: Date.now() - started };
  }

  /** Santé de la socket de CE pod (dont `ingressRejectedTotal`). */
  @route("chat-probe", { path: "/probe", requirements: { methods: ["GET"] } })
  async probe(): Promise<unknown> {
    const p = getRealtimeHub().probe();
    const lobby = getRealtimeHub().presence("chat:lobby");
    return {
      pod: process.env.NF_POD_NAME ?? String(process.pid),
      ingressRejectedTotal: p.ingressRejectedTotal,
      publishTotal: p.publishTotal,
      fanoutTotal: p.fanoutTotal,
      channels: p.channels,
      backplane: p.backplane,
      // Présence du salon vue par CE pod (null tant qu'aucun client ne l'a ouvert).
      lobby:
        lobby === null
          ? null
          : {
              count: lobby.count,
              unnamed: lobby.unnamed,
              partial: lobby.partial,
            },
      presenceProbe: p.presence ?? null,
    };
  }

  protected override realtimeChannels(): string[] {
    return ["chat:room1", "chat:lobby"];
  }

  /**
   * Salon à PRÉSENCE (ADR-0025) : présents partagés entre les pods par le bus,
   * départs retenus 2 s (grâce) — la preuve « deux pods, présence, frappe,
   * départs » du chat (`presence-pods.mjs`).
   */
  @RealtimeChannel("chat:lobby", { presence: { grace: 2000 } })
  lobby(_channel: string, _publish: RealtimePublish): () => void {
    return () => {};
  }

  /** La frappe : un message ÉPHÉMÈRE du salon, jamais un état de présence. */
  @RealtimeInbound("chat:typing")
  onTyping(params: unknown): void {
    if (typeof params !== "object" || params === null || !("author" in params))
      return;
    if (typeof params.author !== "string" || params.author === "") return;
    getRealtimeHub().publish("chat:lobby", {
      typing: params.author.slice(0, 40),
      from: process.env.NF_POD_NAME ?? String(process.pid),
    });
  }

  protected override realtimeActions(): Record<string, RpcActionHandler> {
    return {
      "chat:ping": () => ({ pong: true, pid: process.pid }),
    };
  }

  /** Point d'abonnement pur : aucun producteur local, tout vient des pairs. */
  @RealtimeChannel("chat:room1")
  room1(_channel: string, _publish: RealtimePublish): () => void {
    return () => {};
  }
}

export default ChatController;
```

> `@RealtimeBroadcast` sur la classe déclare le préfixe **à l'import**, donc avant tout
> trafic. L'override `realtimeBroadcastChannels()` existe pour un calcul dynamique, mais il
> n'est lu qu'au handshake d'un client : un pod qui publie sans abonné local ne propagerait
> rien.
