/**
 * Le décor de la voie en direct (ADR-0013 §6) : les deux bouts de l'IPC entre
 * le superviseur et le serveur, simulés comme Node les fait — une copie JSON,
 * livrée plus tard, et un `send()` qui rend `false` sous arriéré alors que le
 * message PART. Partagé par `devLiveChannel.test.ts` et `devLiveRoute.test.ts`.
 */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  isDevChannelMessage,
  type DevChannelMessage,
  type IDevChannelEndpoint,
} from "../service/dev/devChannel";
import type { IServerPeerChild, ServerPeer } from "../service/dev/serverPeer";
import { routeServerMessages } from "../service/dev/DevSupervisor";
import {
  SupervisorLink,
  type ISupervisorHost,
  type LiveCommandExecutor,
} from "../kernel/supervisorLink";

/** Ce que l'IPC de Node fait d'un message : une copie JSON, livrée plus tard. */
export function overIpc(
  message: unknown,
  deliver: (copy: unknown) => void,
): void {
  const copy: unknown = JSON.parse(JSON.stringify(message));
  setImmediate(() => deliver(copy));
}

/** Le `process` du serveur, vu par le lien. */
export class ServerEndpoint
  extends EventEmitter
  implements IDevChannelEndpoint
{
  connected = true;
  readonly channel = { unref(): void {} };
  sent = 0;
  toSupervisor: (message: unknown) => void = () => {};
  send(message: DevChannelMessage): boolean {
    this.sent++;
    overIpc(message, (copy) => this.toSupervisor(copy));
    // Sous arriéré, `process.send()` rend `false` et le message PART quand même.
    return false;
  }
}

/** Le `ChildProcess` du serveur, vu par le superviseur. */
export class ServerChild extends EventEmitter implements IServerPeerChild {
  connected = true;
  constructor(private readonly endpoint: ServerEndpoint) {
    super();
  }
  send(message: DevChannelMessage): boolean {
    overIpc(message, (copy) => this.endpoint.emit("message", copy));
    return false;
  }
}

/** L'hôte minimal d'un `SupervisorLink`. */
export const host: ISupervisorHost = {
  environment: "development",
  isTTY: false,
  projectName: "ARDOISE",
  typeCluster: "master",
  cli: {},
};

/** Attend qu'une condition tienne, au rythme de l'IPC simulée. */
export async function until(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 50 && !cond(); i++) {
    await new Promise((r) => setImmediate(r));
  }
  assert.ok(cond(), "la condition n'a jamais tenu");
}

/**
 * Les deux bouts reliés : le lien du serveur et le pair du superviseur, par le
 * VRAI aiguillage (`routeServerMessages`).
 *
 * @param execute - l'exécuteur du serveur.
 * @param connect - fabrique le pair du superviseur pour l'enfant (défaut : un
 *   `ServerPeer` nu, que la suite fournit).
 * @param serve - `false` : le serveur n'ouvre pas encore la voie (démarrage) ;
 *   la suite appelle `open()` quand elle veut.
 */
export function wireLive(
  execute: LiveCommandExecutor,
  connect: (
    child: ServerChild,
    onError: (context: string, err: unknown) => void,
  ) => ServerPeer,
  serve = true,
) {
  const endpoint = new ServerEndpoint();
  const child = new ServerChild(endpoint);
  const errors: string[] = [];
  const peer = connect(child, (context) => errors.push(context));
  const route = routeServerMessages({
    isCurrent: () => true,
    applyHeldPlan: () => {
      throw new Error("aucun plan attendu");
    },
    retainHeldOwners: () => {},
    reply: () => {},
    receiveRpc: (frame) => peer.receive(frame),
    terminal: null,
  });
  endpoint.toSupervisor = (message) => {
    if (isDevChannelMessage(message)) route(message);
  };
  const link = new SupervisorLink(host, {}, endpoint);
  const open = (): (() => void) =>
    link.serveCommands(execute, (context) => errors.push(context));
  const close = serve ? open() : () => {};
  return { endpoint, child, peer, link, open, close, errors };
}
