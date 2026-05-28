import { describe, it, expect, afterEach } from "vitest";
import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createClient, type RedisClientType } from "redis";

/**
 * Banc e2e cluster **Redis** — workers Node forkés RÉELS (1 process = 1 pod),
 * chacun avec son `RealtimeHub` + `RedisBackplane` branché sur le vrai Redis.
 * Prouve le fan-out cross-PROCESS via Redis (correctness) ET mesure la perf
 * réelle (latence de propagation cross-pod + débit) — ce que le banc IPC ne peut
 * pas mesurer (l'IPC n'a pas la latence réseau Redis).
 *
 * Prérequis : Redis docker up (`@nodefony/redis/docker/docker-compose.yml`).
 *  - Correctness : auto-skip si Redis injoignable.
 *  - Perf (latence/débit) : derrière `RUN_PERF=1` (doctrine perf opt-in) —
 *    un banc de mesure n'est pas une gate de non-régression.
 */
const PASSWORD = process.env.REDIS_PASSWORD ?? "nodefony-dev";
const HOST = process.env.REDIS_HOST ?? "localhost";
const PORT = Number.parseInt(process.env.REDIS_PORT ?? "6379", 10);
const RUN_PERF = process.env.RUN_PERF === "1";
// e2e LOURD : fork de workers (tsx) + Redis réel. Opt-in pour ne pas faire
// échouer le gate par défaut (`npm test` parallèle = contention → ready timeout)
// ni dépendre d'un Redis up. Lancer : `RUN_CLUSTER_E2E=1 REDIS_PASSWORD=… npm test`.
const RUN_CLUSTER_E2E = process.env.RUN_CLUSTER_E2E === "1";

const WORKER_PATH = fileURLToPath(
  new URL("./redisClusterWorker.ts", import.meta.url),
);

async function redisReachable(): Promise<boolean> {
  const probe = createClient({
    socket: {
      host: HOST,
      port: PORT,
      connectTimeout: 1500,
      reconnectStrategy: false,
    },
    password: PASSWORD,
  }) as RedisClientType;
  probe.on("error", () => {});
  try {
    await probe.connect();
    await probe.ping();
    await probe.quit();
    return true;
  } catch {
    try {
      await probe.destroy();
    } catch {
      /* déjà fermé */
    }
    return false;
  }
}
const REDIS_UP = RUN_CLUSTER_E2E ? await redisReachable() : false;
const wait = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

interface AnyMsg {
  cmd?: string;
  op?: string;
  channel?: string;
  pid?: number;
  count?: number;
  received?: number;
  latencies?: number[];
  error?: string;
}

interface ForkedWorker {
  child: ChildProcess;
  pid: number;
  events: AnyMsg[];
  awaitEvent: (
    predicate: (e: AnyMsg) => boolean,
    timeoutMs?: number,
  ) => Promise<AnyMsg>;
}

function spawnWorker(rtChannel: string): Promise<ForkedWorker> {
  return new Promise((resolve, reject) => {
    const child = fork(WORKER_PATH, [], {
      execArgv: ["--import", "tsx"],
      // "ignore" : le banc peut publier des dizaines de milliers de messages ;
      // remonter le stdout des workers sature inutilement le buffer du runner.
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      env: { ...process.env, NODEFONY_CLUSTER: "0", NF_RT_CHANNEL: rtChannel },
    });
    const events: AnyMsg[] = [];
    child.on("message", (raw) => events.push(raw as AnyMsg));
    child.on("error", reject);

    const tReady = setTimeout(
      () => reject(new Error("worker fork: ready timeout")),
      6000,
    );
    const onReady = (raw: unknown): void => {
      const m = raw as AnyMsg;
      if (m?.cmd === "boot-error") {
        clearTimeout(tReady);
        return reject(new Error(`worker boot: ${m.error}`));
      }
      if (m?.cmd !== "ready") return;
      clearTimeout(tReady);
      child.off("message", onReady);
      resolve({
        child,
        pid: m.pid as number,
        events,
        awaitEvent(predicate, timeoutMs = 4000) {
          return new Promise<AnyMsg>((res, rej) => {
            const existing = events.find(predicate);
            if (existing) return res(existing);
            const t = setTimeout(
              () => rej(new Error("awaitEvent: timeout")),
              timeoutMs,
            );
            const onMore = (r2: unknown): void => {
              const mm = r2 as AnyMsg;
              if (predicate(mm)) {
                clearTimeout(t);
                child.off("message", onMore);
                res(mm);
              }
            };
            child.on("message", onMore);
          });
        },
      });
    };
    child.on("message", onReady);
  });
}

function killWorker(w: ForkedWorker): Promise<void> {
  return new Promise((resolve) => {
    if (w.child.exitCode !== null || w.child.signalCode !== null)
      return resolve();
    w.child.once("exit", () => resolve());
    try {
      w.child.send({ cmd: "quit" });
    } catch {
      /* déjà mort */
    }
    setTimeout(() => {
      try {
        w.child.kill("SIGKILL");
      } catch {
        /* idem */
      }
      resolve();
    }, 2000);
  });
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(
    sorted.length - 1,
    Math.floor((p / 100) * sorted.length),
  );
  return sorted[idx];
}

describe.skipIf(!RUN_CLUSTER_E2E || !REDIS_UP)(
  "e2e cluster Redis (Hub + RedisBackplane, Redis = relay)",
  () => {
    let workers: ForkedWorker[] = [];

    afterEach(async () => {
      await Promise.allSettled(workers.map((w) => killWorker(w)));
      workers = [];
    });

    it("fan-out cross-process RÉEL : A publish → B et C reçoivent (anti-echo sur A)", async () => {
      const channel = `chan:${Date.now()}`;
      const rt = `nodefony:rt:e2e:${Date.now()}`;
      const [a, b, c] = await Promise.all([
        spawnWorker(rt),
        spawnWorker(rt),
        spawnWorker(rt),
      ]);
      workers = [a, b, c];

      for (const w of workers) {
        w.child.send({ cmd: "subscribe", channel });
        await w.awaitEvent((e) => e.cmd === "ack" && e.op === "subscribe");
      }
      await wait(150); // abonnements Redis effectifs sur tous les pods

      a.child.send({ cmd: "publish", channel, payload: { hello: 1 } });
      await a.awaitEvent((e) => e.cmd === "ack" && e.op === "publish");

      // Laisse Redis propager (pub/sub best-effort async), puis interroge chaque pod.
      await wait(250);
      for (const w of workers) w.child.send({ cmd: "report", channel });
      const [ra, rb, rc] = await Promise.all([
        a.awaitEvent((e) => e.cmd === "report"),
        b.awaitEvent((e) => e.cmd === "report"),
        c.awaitEvent((e) => e.cmd === "report"),
      ]);

      expect(rb.received, "B reçoit le message cross-pod").to.equal(1);
      expect(rc.received, "C reçoit le message cross-pod").to.equal(1);
      // A est abonné → reçoit son message 1× via fan-out LOCAL. L'anti-echo
      // garantit qu'il ne le reçoit PAS une 2ᵉ fois en rebond via Redis (sinon 2).
      expect(
        ra.received,
        "A reçoit son propre message UNE seule fois (local), jamais en rebond Redis",
      ).to.equal(1);
    });

    it.skipIf(!RUN_PERF)(
      "PERF : latence p50/p99 + débit du fan-out cross-pod via Redis",
      async () => {
        const channel = `perf:${Date.now()}`;
        const rt = `nodefony:rt:perf:${Date.now()}`;
        const COUNT = Number.parseInt(process.env.NF_PERF_COUNT ?? "5000", 10);
        const [a, b] = await Promise.all([spawnWorker(rt), spawnWorker(rt)]);
        workers = [a, b];

        // B s'abonne (récepteur) ; A marque seulement le canal broadcast (émetteur
        // pur, pas de sink local → mesure A→B pure sans fan-out local parasite).
        b.child.send({ cmd: "subscribe", channel });
        await b.awaitEvent((e) => e.cmd === "ack" && e.op === "subscribe");
        a.child.send({ cmd: "mark-broadcast", channel });
        await a.awaitEvent((e) => e.cmd === "ack" && e.op === "mark-broadcast");
        await wait(150);

        const t0 = Date.now();
        a.child.send({ cmd: "publish-burst", channel, count: COUNT });
        await a.awaitEvent(
          (e) => e.cmd === "ack" && e.op === "publish-burst",
          15000,
        );

        // Laisse Redis drainer le burst vers B.
        await wait(800);
        b.child.send({ cmd: "report", channel });
        const rep = await b.awaitEvent((e) => e.cmd === "report", 10000);
        const elapsed = Date.now() - t0;

        const lat = (rep.latencies ?? []).slice().sort((x, y) => x - y);
        const received = rep.received ?? 0;
        const lossPct = ((COUNT - received) / COUNT) * 100;
        const throughput = Math.round((received / elapsed) * 1000);

        // eslint-disable-next-line no-console
        console.log(
          `\n  ── RedisBackplane perf (A→B cross-pod, Redis local) ──\n` +
            `  envoyés=${COUNT} reçus=${received} perte=${lossPct.toFixed(2)}%\n` +
            `  latence ms  p50=${percentile(lat, 50)} p90=${percentile(lat, 90)} ` +
            `p99=${percentile(lat, 99)} max=${lat[lat.length - 1] ?? "n/a"}\n` +
            `  débit≈${throughput} msg/s (sur ${elapsed} ms)\n`,
        );

        // Assertions souples (banc, pas gate stricte) : au moins la livraison marche.
        expect(
          received,
          "au moins une partie du burst livrée",
        ).to.be.greaterThan(0);
        expect(lat.length, "des latences mesurées").to.be.greaterThan(0);
      },
      30000,
    );
  },
);
