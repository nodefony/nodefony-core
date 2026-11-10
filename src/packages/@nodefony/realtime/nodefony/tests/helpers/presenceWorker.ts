import { ownField } from "nodefony";
import type { ContextType } from "@nodefony/http";
import { createTestIdentity } from "@nodefony/security/testing";
import { NodefonySocket } from "../../../../../../nodefony/src/client/realtime/NodefonySocket.js";
import { observePresence } from "../../../../../../nodefony/src/client/realtime/observe.js";
import type { IBackplane } from "../../interfaces/IBackplane";
import type { RealtimeHub } from "../../src/server/RealtimeHub";
import { RealtimeController } from "../../src/server/RealtimeController";
import { shutdownRealtime } from "../../src/server/realtimeShutdown";
import { presenceClient, presenceView } from "./presenceClient";
import {
  LoopbackClientTransport,
  LoopbackWire,
  loopbackServerContext,
} from "./loopback";

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
 * Contrôleur de la route WebSocket d'un worker : sert les canaux `pres:*` aux
 * onglets de navigateur. `feed` est le pont vers `handleRealtime`, que la route
 * générée appelle en vrai.
 */
class BrowserRt extends RealtimeController {
  constructor(ctx: ContextType) {
    super("BrowserRt", ctx);
  }
  feed(raw: string | Uint8Array | null): void {
    this.handleRealtime(raw);
  }
  override createRealtimeChannel(channel: string): (() => void) | null {
    return channel.startsWith(WORKER_PRESENCE_PREFIX) ? () => {} : null;
  }
}

/** Un onglet de navigateur ouvert par `presence-browser`. */
interface IBrowserTab {
  readonly socket: NodefonySocket;
  /** Coupe la connexion COURANTE côté serveur, comme une WebSocket tombée. */
  drop: (() => void) | null;
  /**
   * Réseau coupé : la prochaine connexion n'ouvre qu'à `release` — l'écran est
   * alors observable ENTRE la chute et le retour, sans course contre un délai.
   */
  hold: Promise<void> | null;
  release: (() => void) | null;
}

/** Les onglets du worker, par nom d'onglet — un worker = un processus. */
const browserTabs = new Map<string, IBrowserTab>();

/**
 * Ouvre un onglet : un VRAI `NodefonySocket` du cœur, relié par un câble en
 * mémoire à un VRAI `RealtimeController` de ce pod, et `observePresence` (le
 * socle des quatre liaisons). Chaque instantané POUSSÉ à l'écran part au
 * master (`browser-view`) : le banc juge ce que l'écran affiche, jamais une
 * lecture tirée. Une reconnexion refait un câble et un contrôleur neufs.
 */
async function openBrowserTab(
  hub: RealtimeHub,
  tab: string,
  user: string,
  channel: string,
  send: (message: unknown) => void,
): Promise<void> {
  // Un vhost propre à l'onglet : le hub retient le premier authentificateur
  // qui matche, un motif commun donnerait la même identité à tous les onglets.
  const host = `tab-${tab}.invalid`;
  if (user !== "") {
    const identity = createTestIdentity({ identifier: user });
    hub.useAuthenticator(
      { pattern: /.*/u, host },
      {
        name: "browser-tab",
        supports: () => true,
        authenticate: () => Promise.resolve(identity),
      },
    );
  }
  const socket = new NodefonySocket(
    {
      url: "ws://loopback/realtime",
      autoReconnect: true,
      reconnectDelay: 1,
      reconnectDelayMax: 1,
    },
    () => {
      const wire = new LoopbackWire();
      const { ctx, fireFinish, closeServer } = loopbackServerContext(wire, {
        host,
      });
      const rt = new BrowserRt(ctx);
      wire.feedServer = (raw) => rt.feed(raw);
      entry.drop = () => {
        closeServer(1006, "dropped");
        fireFinish();
      };
      const transport = new LoopbackClientTransport(wire);
      const hold = entry.hold;
      if (hold !== null) {
        const open = transport.connect.bind(transport);
        transport.connect = () => void hold.then(open);
      }
      return transport;
    },
  );
  const entry: IBrowserTab = { socket, drop: null, hold: null, release: null };
  browserTabs.set(tab, entry);
  await socket.connect();
  observePresence(socket, channel, (view) => {
    const members: Record<string, number> = {};
    for (const [identity, value] of view.members)
      members[identity] = value.tabs;
    send({
      cmd: "browser-view",
      tab,
      ready: view.ready,
      count: view.count,
      unnamed: view.unnamed,
      partial: view.partial,
      members,
      pid: process.pid,
    });
  });
}

/**
 * Commandes de présence d'un worker forké, communes aux bancs IPC et Redis :
 * - `presence-member` — un présent nommé, ou anonyme sans `user`, posé par le kit serveur ;
 * - `presence` — la vue lue ici par le hub ;
 * - `presence-terminate` — la séquence de l'arrêt du noyau : l'écouteur `onTerminate` du module (`shutdownRealtime`, le MÊME code), puis la sortie au tick suivant ;
 * - `presence-browser` — un onglet de navigateur (`tab`, `user` vide = anonyme) qui affiche la présence de `channel` ;
 * - `presence-browser-drop` — la connexion de l'onglet `tab` tombe côté serveur, réseau coupé : la reconnexion (que le client tente seul) attend `presence-browser-resume`.
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
    case "presence-browser": {
      const tab = text("tab");
      void openBrowserTab(hub, tab, text("user"), text("channel"), send).then(
        () =>
          send({ cmd: "ack", op: "presence-browser", tab, pid: process.pid }),
      );
      return true;
    }
    case "presence-browser-drop": {
      const tab = text("tab");
      const entry = browserTabs.get(tab);
      if (entry !== undefined) {
        entry.hold = new Promise<void>((resolve) => {
          entry.release = resolve;
        });
        entry.drop?.();
      }
      send({ cmd: "ack", op: "presence-browser-drop", tab, pid: process.pid });
      return true;
    }
    case "presence-browser-resume": {
      const tab = text("tab");
      const entry = browserTabs.get(tab);
      if (entry !== undefined) {
        entry.hold = null;
        entry.release?.();
        entry.release = null;
      }
      send({
        cmd: "ack",
        op: "presence-browser-resume",
        tab,
        pid: process.pid,
      });
      return true;
    }
    default:
      return false;
  }
}
