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
import { CLUSTER_RT_KIND } from "nodefony";
import { getRealtimeHub } from "../../src/server/RealtimeHub.js";
import {
  ClusterBackplane,
  processIpcTransport,
} from "../../src/backplane/ClusterBackplane.js";

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

interface ControlMsg {
  cmd?: string;
  channel?: string;
  payload?: unknown;
  prefix?: string;
}

process.on("message", (raw: unknown) => {
  // Tri : on ignore les enveloppes realtime (déjà traitées par le backplane).
  if (
    typeof raw === "object" &&
    raw !== null &&
    (raw as { kind?: unknown }).kind === CLUSTER_RT_KIND
  ) {
    return;
  }
  const msg = raw as ControlMsg;
  if (!msg || typeof msg !== "object" || typeof msg.cmd !== "string") return;

  switch (msg.cmd) {
    case "subscribe": {
      const channel = msg.channel as string;
      // Canal broadcast : marqué à la subscribe pour que `hub.publish` propage.
      hub.markBroadcastChannel(channel);
      const state: SubState = {
        sink: (payload) => {
          state.receivedCount += 1;
          process.send?.({
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
      process.send?.({
        cmd: "ack",
        op: "subscribe",
        channel,
        pid: process.pid,
      });
      break;
    }
    case "mark-broadcast": {
      hub.markBroadcastChannel(msg.prefix as string);
      process.send?.({
        cmd: "ack",
        op: "mark-broadcast",
        prefix: msg.prefix,
        pid: process.pid,
      });
      break;
    }
    case "publish": {
      hub.publish(msg.channel as string, msg.payload);
      process.send?.({
        cmd: "ack",
        op: "publish",
        channel: msg.channel,
        pid: process.pid,
      });
      break;
    }
    case "stats": {
      const out: Record<string, number> = {};
      for (const [ch, st] of subs) out[ch] = st.receivedCount;
      process.send?.({ cmd: "stats", subs: out, pid: process.pid });
      break;
    }
    case "quit": {
      process.exit(0);
      break;
    }
  }
});

process.send?.({ cmd: "ready", pid: process.pid });
