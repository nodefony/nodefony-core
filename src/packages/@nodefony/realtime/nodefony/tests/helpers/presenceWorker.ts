import { ownField } from "nodefony";
import type { IBackplane } from "../../interfaces/IBackplane";
import type { RealtimeHub } from "../../src/server/RealtimeHub";
import { shutdownRealtime } from "../../src/server/realtimeShutdown";
import { presenceClient, presenceView } from "./presenceClient";

/** Préfixe des canaux à présence diffusée des workers de banc. */
export const WORKER_PRESENCE_PREFIX = "pres:";

/**
 * Déclare sur le hub d'un worker de banc les canaux `pres:*` à présence, diffusés entre processus (#760).
 */
export function declareWorkerPresence(hub: RealtimeHub): void {
  hub.declareChannelPolicy(
    `${WORKER_PRESENCE_PREFIX}*`,
    { presence: true },
    null,
  );
  hub.markBroadcastChannel(WORKER_PRESENCE_PREFIX);
}

/**
 * Commandes de présence d'un worker forké, communes aux bancs IPC et Redis — `presence-member` (un présent nommé, ou anonyme sans `user`), `presence` (la vue lue ici), `presence-terminate` (la séquence de l'arrêt du noyau : l'écouteur `onTerminate` du module — `shutdownRealtime`, le MÊME code —, puis la sortie au tick suivant).
 *
 * @param owned - le bus que le worker a créé, arrêté par `presence-terminate`.
 * @returns `true` si la commande était l'une d'elles (traitée), `false` sinon.
 */
export function handlePresenceCommand(
  hub: RealtimeHub,
  raw: unknown,
  send: (message: unknown) => void,
  owned: IBackplane,
): boolean {
  const cmd = ownField(raw, "cmd");
  const text = (key: string): string => {
    const value = ownField(raw, key);
    return typeof value === "string" ? value : "";
  };
  switch (cmd) {
    case "presence-member": {
      const user = text("user");
      presenceClient(hub, text("channel"), user === "" ? null : user);
      send({ cmd: "ack", op: "presence-member", pid: process.pid });
      return true;
    }
    case "presence": {
      const channel = text("channel");
      const view = hub.presence(channel);
      send({
        cmd: "presence",
        channel,
        members: presenceView(hub, channel),
        unnamed: view?.unnamed ?? -1,
        partial: view?.partial ?? null,
        probe: hub.probe().presence ?? null,
        pid: process.pid,
      });
      return true;
    }
    case "presence-terminate": {
      void shutdownRealtime(hub, owned).then(() => {
        process.nextTick(() => process.exit(0));
      });
      return true;
    }
    default:
      return false;
  }
}
