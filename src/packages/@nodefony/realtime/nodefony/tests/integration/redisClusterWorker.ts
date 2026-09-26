/**
 * Worker fork pour le banc e2e cluster **Redis** du module @nodefony/realtime.
 *
 * Contrairement au harnais IPC (`clusterIpcWorker.ts`, qui passe par un
 * `ClusterRelay` côté master), ici **Redis EST le relay** : chaque worker se
 * connecte DIRECTEMENT au vrai Redis et câble son `RealtimeHub` sur un
 * `RedisBackplane` — exactement comme un pod en prod multi-host. Le master ne
 * relaie aucun message realtime ; il ne fait que piloter les workers en IPC
 * (subscribe / publish / report / quit).
 *
 *   worker A (fork)            Redis (pub/sub)            worker B (fork)
 *   Hub + RedisBackplane  <--->  nodefony:rt:*  <--->  Hub + RedisBackplane
 *
 * Timing : `setBackplane` appelle `start()` en fire-and-forget. Comme `start()`
 * est idempotent, on fait `await bp.start()` AVANT `setBackplane` → l'abonnement
 * Redis est garanti effectif quand le worker annonce `ready`.
 *
 * Démarré via `fork(path, [], { execArgv: ['--import', 'tsx'] })`.
 */
import { createClient, type RedisClientType } from "redis";
import { getRealtimeHub } from "../../src/server/RealtimeHub.js";
import {
  RedisBackplane,
  createRedisServiceTransport,
} from "../../src/backplane/RedisBackplane.js";

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

const PASSWORD = process.env.NF_REDIS_PASSWORD ?? "nodefony-dev";
const HOST = process.env.NF_REDIS_HOST ?? "localhost";
const PORT = Number.parseInt(process.env.NF_REDIS_PORT ?? "6379", 10);
// Canal Redis partagé pour ce run (le master le passe via env pour isoler les runs).
const RT_CHANNEL = process.env.NF_RT_CHANNEL ?? "nodefony:rt:e2e";

function mkClient(): RedisClientType {
  const c = createClient({
    socket: { host: HOST, port: PORT, reconnectStrategy: false },
    password: PASSWORD,
  }) as RedisClientType;
  c.on("error", () => {});
  return c;
}

interface SubState {
  sink: (payload: unknown) => void;
  receivedCount: number;
  /** Latences de propagation cross-pod (ms) collectées à la réception. */
  latencies: number[];
}
const subs = new Map<string, SubState>();

interface ControlMsg {
  cmd?: string;
  channel?: string;
  payload?: unknown;
  count?: number;
}

const pub = mkClient();
const sub = mkClient();

async function boot(): Promise<void> {
  await pub.connect();
  await sub.connect();
  const hub = getRealtimeHub();
  const bp = new RedisBackplane(
    createRedisServiceTransport(pub, sub),
    String(process.pid),
    RT_CHANNEL,
  );
  // Abonnement Redis effectif AVANT ready (start idempotent → no-op dans setBackplane).
  await bp.start();
  hub.setBackplane(bp);

  process.on("message", (raw: unknown) => {
    const msg = raw as ControlMsg;
    if (!msg || typeof msg !== "object" || typeof msg.cmd !== "string") return;

    switch (msg.cmd) {
      case "subscribe": {
        const channel = msg.channel as string;
        hub.markBroadcastChannel(channel);
        const state: SubState = {
          receivedCount: 0,
          latencies: [],
          sink: (payload) => {
            state.receivedCount += 1;
            // Latence cross-pod : Date.now() comparable entre process même machine.
            const t = (payload as { t?: number })?.t;
            if (typeof t === "number") state.latencies.push(Date.now() - t);
          },
        };
        subs.set(channel, state);
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
        // Marque le canal broadcast SANS s'abonner (émetteur pur : pas de sink
        // local, donc pas de fan-out local qui fausserait une mesure A→B).
        hub.markBroadcastChannel(msg.channel as string);
        sendToMaster({
          cmd: "ack",
          op: "mark-broadcast",
          channel: msg.channel,
          pid: process.pid,
        });
        break;
      }
      case "publish": {
        hub.publish(msg.channel as string, msg.payload);
        sendToMaster({
          cmd: "ack",
          op: "publish",
          channel: msg.channel,
          pid: process.pid,
        });
        break;
      }
      case "publish-burst": {
        const channel = msg.channel as string;
        const count = msg.count ?? 0;
        for (let i = 0; i < count; i += 1) {
          hub.publish(channel, { t: Date.now(), seq: i });
        }
        sendToMaster({
          cmd: "ack",
          op: "publish-burst",
          channel,
          count,
          pid: process.pid,
        });
        break;
      }
      case "report": {
        const channel = msg.channel as string;
        const st = subs.get(channel);
        sendToMaster({
          cmd: "report",
          channel,
          pid: process.pid,
          received: st?.receivedCount ?? 0,
          latencies: st?.latencies ?? [],
        });
        break;
      }
      case "quit": {
        void (async (): Promise<void> => {
          try {
            await bp.stop();
            if (pub.isOpen) await pub.quit();
            if (sub.isOpen) await sub.quit();
          } finally {
            process.exit(0);
          }
        })();
        break;
      }
    }
  });

  sendToMaster({ cmd: "ready", pid: process.pid });
}

void boot().catch((e: unknown) => {
  sendToMaster({
    cmd: "boot-error",
    error: e instanceof Error ? e.message : String(e),
  });
  process.exit(1);
});
