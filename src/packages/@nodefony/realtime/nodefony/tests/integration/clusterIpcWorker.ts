/**
 * Worker fork pour les tests e2e cluster IPC du module @nodefony/realtime.
 *
 * Reçoit des commandes de contrôle du master (`{ cmd: "subscribe" | "publish" |
 * "mark-broadcast" | "stats" | "quit" }`) et expose son `RealtimeHub` câblé sur
 * un `ClusterBackplane(processIpcTransport)` réel — exactement comme un worker
 * de `nodefony cluster -w N` en prod. Chaque worker a son PROPRE singleton
 * `getRealtimeHub()` (per-process) et son PROPRE backplane (originId = pid).
 *
 * Communication IPC :
 *  - master → worker : `child.send({ cmd, ... })` (messages de contrôle ; le
 *    backplane les ignore car ils ne portent pas `CLUSTER_RT_KIND`).
 *  - master ← worker (contrôle) : `process.send({ cmd, ... })` (ack, got,
 *    stats, ready).
 *  - master ↔ workers (realtime) : `CLUSTER_RT_KIND` enveloppes, routées par
 *    `ClusterRelay` côté master (rebroadcast aux AUTRES workers).
 *
 * Démarré via `child_process.fork(path, [], { execArgv: ['--import', 'tsx'] })`
 * — `tsx` permet de charger le source TS directement, sans rebuild.
 */
import {
  CLUSTER_RT_KIND,
  isRealtimePayload,
  ownField,
  realtimePayloadError,
} from "nodefony";
import { getRealtimeHub } from "../../src/server/RealtimeHub.js";
import { RealtimeController } from "../../src/server/RealtimeController.js";
import {
  createRealtimeHarness,
  type IRealtimeHarness,
} from "../../testing/index.js";
import type { IRealtimeToken } from "../../interfaces/IRealtimeToken.js";
import {
  ClusterBackplane,
  processIpcTransport,
} from "../../src/backplane/ClusterBackplane.js";

/**
 * Envoie un message de contrôle au master — et seulement si le canal IPC est
 * encore ouvert.
 *
 * `process.send?.()` ne garde que contre l'absence de canal (process non forké) ;
 * il n'empêche PAS l'écriture sur un canal FERMÉ, qui lève `EPIPE` en événement
 * `error` non géré et tue le worker. Le cas arrive dès que le master abandonne
 * avant la fin du boot : son `EPIPE` bruyant remplaçait alors la vraie cause —
 * un boot plus lent que le budget d'attente — dans la sortie de la suite.
 */
function sendToMaster(message: unknown): void {
  if (!process.connected) return;
  try {
    process.send?.(message);
  } catch {
    // Course entre le test `connected` et l'écriture : le master peut fermer
    // entre les deux. Un worker qui n'a plus d'interlocuteur n'a rien à dire.
  }
}

const hub = getRealtimeHub();
// Branche le backplane IPC comme le ferait `Realtime.#wireCluster` en cluster réel.
hub.setBackplane(
  new ClusterBackplane(processIpcTransport, String(process.pid)),
);

interface SubState {
  sink: (payload: unknown) => void;
  receivedCount: number;
}
const subs = new Map<string, SubState>();

/**
 * Contrôleur des connexions RÉELLES du worker (#623) : sert les canaux `room:`.
 * Les abonnements de service (`subscribe`) ne sont pas des membres ; seules ces
 * connexions-là peuvent être éjectées ou recevoir la fin d'un canal.
 */
class RoomRt extends RealtimeController {
  constructor(ctx: ConstructorParameters<typeof RealtimeController>[1]) {
    super("RoomRt", ctx);
  }
  override createRealtimeChannel(channel: string): (() => void) | null {
    return channel.startsWith("room:") ? () => {} : null;
  }
}

function tokenOf(id: string): IRealtimeToken {
  return {
    type: "session",
    getUserIdentifier: () => id,
    isAuthenticated: () => true,
    getRoles: () => ["ROLE_USER"],
    getScopes: () => [],
    getAttribute: () => undefined,
    getIdentity: () =>
      Object.freeze({
        type: "session",
        authenticated: true,
        id,
        userIdentifier: id,
        roles: Object.freeze(["ROLE_USER"]),
        scopes: Object.freeze([]),
        issuer: null,
        account: true,
      }),
  };
}

/** Connexions réelles ouvertes par `member`, avec leur compte. */
const members: { user: string; tab: IRealtimeHarness<RoomRt> }[] = [];

/** Les `realtime:closed` reçus par chaque connexion, `compte → [raisons]`. */
function closedReasons(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const { user, tab } of members)
    for (const f of tab.received)
      if (f.method === "realtime:closed") {
        const reason = ownField(f.params, "reason");
        (out[user] ??= []).push(typeof reason === "string" ? reason : "?");
      }
  return out;
}

process.on("message", (raw: unknown) => {
  // Tri : on ignore les enveloppes realtime (déjà traitées par le backplane).
  if (ownField(raw, "kind") === CLUSTER_RT_KIND) return;
  const cmd = ownField(raw, "cmd");
  if (typeof cmd !== "string") return;
  /** Un champ texte du message de contrôle ; `""` s'il manque. */
  const text = (key: string): string => {
    const value = ownField(raw, key);
    return typeof value === "string" ? value : "";
  };

  switch (cmd) {
    case "subscribe": {
      const channel = text("channel");
      // Canal broadcast : marqué à la subscribe pour que `hub.publish` propage.
      hub.markBroadcastChannel(channel);
      const state: SubState = {
        sink: (payload) => {
          state.receivedCount += 1;
          sendToMaster({
            cmd: "got",
            channel,
            payload,
            pid: process.pid,
          });
        },
        receivedCount: 0,
      };
      subs.set(channel, state);
      // Factory dummy (pas de provider externe : sink seul suffit pour les tests).
      hub.subscribe(channel, state.sink, () => () => {});
      sendToMaster({
        cmd: "ack",
        op: "subscribe",
        channel,
        pid: process.pid,
      });
      break;
    }
    case "mark-broadcast": {
      hub.markBroadcastChannel(text("prefix"));
      sendToMaster({
        cmd: "ack",
        op: "mark-broadcast",
        prefix: text("prefix"),
        pid: process.pid,
      });
      break;
    }
    case "publish": {
      const channel = text("channel");
      const payload = ownField(raw, "payload");
      // L'IPC rend `unknown` : même garde que le hub, pour typer la charge.
      if (!isRealtimePayload(payload))
        throw realtimePayloadError(channel, payload);
      hub.publish(channel, payload);
      sendToMaster({
        cmd: "ack",
        op: "publish",
        channel,
        pid: process.pid,
      });
      break;
    }
    case "member": {
      // Une VRAIE connexion (harnais, hub partagé — jamais remis à zéro : il
      // porte le backplane) abonnée à `channel` par le client.
      const user = text("user") || "anonymous";
      const channel = text("channel");
      const tab = createRealtimeHarness((ctx) => new RoomRt(ctx), {
        identity: tokenOf(user),
        resetHub: false,
      });
      members.push({ user, tab });
      void tab
        .connect()
        .then(() => tab.subscribe(channel))
        .then(() =>
          sendToMaster({ cmd: "ack", op: "member", channel, pid: process.pid }),
        );
      break;
    }
    case "evict-user": {
      const count = hub.evictUser(text("channel"), text("user"));
      sendToMaster({ cmd: "ack", op: "evict-user", count, pid: process.pid });
      break;
    }
    case "close-channel": {
      const count = hub.closeChannel(text("channel"));
      sendToMaster({
        cmd: "ack",
        op: "close-channel",
        count,
        pid: process.pid,
      });
      break;
    }
    case "closed": {
      sendToMaster({
        cmd: "closed",
        closed: closedReasons(),
        pid: process.pid,
      });
      break;
    }
    case "stats": {
      const out: Record<string, number> = {};
      for (const [ch, st] of subs) out[ch] = st.receivedCount;
      sendToMaster({ cmd: "stats", subs: out, pid: process.pid });
      break;
    }
    case "quit": {
      process.exit(0);
    }
  }
});

sendToMaster({ cmd: "ready", pid: process.pid });
