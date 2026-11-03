import { randomUUID } from "node:crypto";
import { controller, route } from "@nodefony/framework";
import type { ContextType } from "@nodefony/http";
import {
  RealtimeChannel,
  RealtimeController,
  RealtimeInbound,
  getRealtimeHub,
} from "../../../../index";
import type { IRealtimeConnection } from "../../../../index";

/** Tâche en cours → son demandeur. Seul le demandeur suit le flux de SA tâche. */
export const owners = new Map<string, string>();

// Sa socket : `/api/task/realtime` (préfixe + route). Elle ne sert que les canaux déclarés ici.
@controller("/api/task")
export class TaskRealtime extends RealtimeController {
  constructor(context: ContextType) {
    super("TaskRealtime", context);
  }

  // Le point d'entrée : `handleRealtime` fait tout le protocole et route vers les décorateurs.
  @route("task-realtime", {
    path: "/realtime",
    requirements: { methods: ["WEBSOCKET"] },
  })
  async realtime(message: string | Uint8Array | null): Promise<void> {
    this.handleRealtime(message);
  }

  @RealtimeChannel("task:*", {
    allow: (channel, who) => owners.get(channel) === who.id,
  })
  task(): () => void {
    return () => {};
  }

  override createRealtimeChannel(channel: string): (() => void) | null {
    return owners.has(channel) ? () => {} : null; // tâche finie : plus de canal
  }

  @RealtimeInbound("task:start", { authenticated: true })
  async start(
    _params: unknown,
    reply: (payload: object) => void,
    connection: IRealtimeConnection,
  ): Promise<void> {
    if (connection.userId === null) return;
    const task = `task:${randomUUID()}`; // nom choisi par le SERVEUR, jamais par le client
    owners.set(task, connection.userId);
    if (await getRealtimeHub().subscribeConnection(task, connection)) {
      reply({ task }); // le navigateur apprend le nom du canal qu'il suit déjà
      void run(task);
    }
  }
}

/** Le travail long : il publie sa progression, puis termine le canal pour tous. */
export async function run(task: string): Promise<void> {
  const hub = getRealtimeHub();
  for (const step of ["lecture", "analyse", "rédaction"]) {
    hub.publish(task, { step });
    await new Promise((resolve) => setTimeout(resolve, 0)); // le vrai travail
  }
  owners.delete(task);
  hub.closeChannel(task); // le client reçoit `realtime:closed { reason: "ended" }`
}
