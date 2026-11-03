import { randomUUID } from "node:crypto";
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
 * Les tâches longues : qui a demandé quoi, et le travail lui-même. Chaque
 * tâche a son canal, nommé par le SERVEUR ; seul son demandeur le suit.
 */
@injectable()
export class TaskService extends Service {
  /** Tâche en cours → son demandeur. */
  readonly #owners = new Map<string, string>();

  constructor(module: Module) {
    super("tasks", module.container ?? undefined, module.notificationsCenter);
  }

  /** Ouvre une tâche pour ce compte ; rend le nom de son canal, jamais choisi par le client. */
  open(owner: string): string {
    const task = `task:${randomUUID()}`;
    this.#owners.set(task, owner);
    return task;
  }

  /** Ce compte a-t-il demandé cette tâche ? */
  isOwner(task: string, user: string | null): boolean {
    return user !== null && this.#owners.get(task) === user;
  }

  /** La tâche tourne-t-elle encore ? Finie, elle n'a plus de canal. */
  isRunning(task: string): boolean {
    return this.#owners.has(task);
  }

  /** Le travail long : il publie sa progression, puis termine le canal pour tous. */
  async run(task: string): Promise<void> {
    const hub = getRealtimeHub();
    for (const step of ["lecture", "analyse", "rédaction"]) {
      hub.publish(task, { step });
      await new Promise((resolve) => setTimeout(resolve, 0)); // le vrai travail
    }
    this.#owners.delete(task);
    hub.closeChannel(task); // le client reçoit `realtime:closed { reason: "ended" }`
  }
}

/** Qui suit `task:*` : le demandeur de la tâche, et lui seul. */
@injectable()
export class TaskAdmission extends Service implements IChannelAdmission {
  constructor(@Inject("TaskService") private readonly tasks: TaskService) {
    super("taskAdmission");
  }

  allow(channel: string, who: ISubscriberIdentity): boolean {
    return this.tasks.isOwner(channel, who.id);
  }
}

// Sa socket : `/api/task/realtime` (préfixe + route). Elle ne sert que les canaux déclarés ici.
@controller("/api/task")
export class TaskRealtime extends RealtimeController {
  // Instancié PAR CONNEXION : les tâches vivent dans le service, le même pour tous.
  constructor(
    context: ContextType,
    @Inject("TaskService") private readonly tasks: TaskService,
  ) {
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

  @RealtimeChannel("task:*", { allow: TaskAdmission })
  task(): () => void {
    return () => {};
  }

  // Une tâche finie n'a plus de canal.
  override createRealtimeChannel(channel: string): (() => void) | null {
    return this.tasks.isRunning(channel) ? () => {} : null;
  }

  @RealtimeInbound("task:start", { authenticated: true })
  async start(
    _params: unknown,
    reply: (payload: object) => void,
    connection: IRealtimeConnection,
  ): Promise<void> {
    if (connection.userId === null) return;
    const task = this.tasks.open(connection.userId);
    if (await getRealtimeHub().subscribeConnection(task, connection)) {
      reply({ task }); // le navigateur apprend le nom du canal qu'il suit déjà
      void this.tasks.run(task);
    }
  }
}
