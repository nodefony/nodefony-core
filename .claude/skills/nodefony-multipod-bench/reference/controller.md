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
    const body = (this.context.request?.body ?? {}) as { msg?: string };
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
    // La query vit sur la REQUÊTE (`request.query`), pas sur le contexte : un
    // `context.query` inexistant retombe silencieusement sur la valeur par
    // défaut — la rafale paraît lancée, elle ne publie que 100 messages.
    const q = this.context.request?.query as
      Record<string, unknown> | undefined;
    const n = Number(q?.n ?? 100);
    const hub = getRealtimeHub();
    const started = Date.now();
    for (let i = 0; i < n; i++) {
      hub.publish("chat:room1", {
        seq: i,
        ts: Date.now(),
        from: process.env.NF_POD_NAME,
      });
    }
    return { published: n, elapsedMs: Date.now() - started };
  }

  /** Santé de la socket de CE pod (dont `ingressRejectedTotal`). */
  @route("chat-probe", { path: "/probe", requirements: { methods: ["GET"] } })
  async probe(): Promise<unknown> {
    const p = getRealtimeHub().probe();
    return {
      pod: process.env.NF_POD_NAME ?? String(process.pid),
      ingressRejectedTotal: p.ingressRejectedTotal,
      publishTotal: p.publishTotal,
      fanoutTotal: p.fanoutTotal,
      channels: p.channels,
      backplane: p.backplane,
    };
  }

  protected override realtimeChannels(): string[] {
    return ["chat:room1"];
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
