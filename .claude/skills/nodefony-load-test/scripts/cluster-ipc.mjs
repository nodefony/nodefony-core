// Bench du FIL IPC du backplane cluster Nodefony (mode sans PM2) — mesure le coût RÉEL
// du fan-out cross-process worker→MASTER(gateway)→workers, AVANT Redis.
//
// ⚠️ Différent des autres scripts du skill : il NE dépend PAS du serveur dev. Il `fork`
// lui-même N workers (cluster Node natif) et fait tourner les VRAIS composants livrés :
//   - master  : `ClusterRelay`  (nodefony)            — routeur IPC, exclut la source
//   - worker  : `ClusterBackplane` + `processIpcTransport` (@nodefony/realtime)
// C'est le HARNAIS de la vision cluster-backplane : « comme si Redis était là », gratuit.
//
// Deux modes :
//   MODE=throughput (défaut) — 1 publisher floode un canal, (N-1) subscribers drainent.
//       → publishes/s (au master) · deliveries/s (fan-out IPC) · MB/s · backlog publisher.
//   MODE=rtt                 — 1 publisher envoie des pings cadencés, les subs renvoient
//       un pong (re-publish) → RTT aller-retour worker→master→worker→master→worker,
//       mesuré sur l'horloge du SEUL publisher (perf.now) → p50/p99/max.
//
// Prérequis : `npm run build` (core + framework) — le bench importe les dist.
// Lancement (depuis la racine repo) :
//   node .claude/skills/nodefony-load-test/scripts/cluster-ipc.mjs
//   WORKERS=8 PAYLOAD=1024 DURATION=8 node .../cluster-ipc.mjs
//   MODE=rtt WORKERS=2 RATE=2000 DURATION=5 node .../cluster-ipc.mjs
import cluster from "node:cluster";
import process from "node:process";
import { performance } from "node:perf_hooks";
import { ClusterRelay, CLUSTER_RT_KIND } from "nodefony";
import { ClusterBackplane, processIpcTransport } from "@nodefony/realtime";

const WORKERS = Math.max(2, Number(process.env.WORKERS || 4));
const PAYLOAD = Number(process.env.PAYLOAD || 256); // octets de bourrage / message
const DURATION = Number(process.env.DURATION || 5); // secondes de mesure
const MODE = process.env.MODE || "throughput"; // throughput | rtt
const RATE = Number(process.env.RATE || 2000); // pings/s (mode rtt)
const BATCH = Number(process.env.BATCH || 500); // msgs par tick (mode throughput)
const CHANNEL = process.env.CHANNEL || "bench:flood";
const RETURN = "bench:pong";

const BENCH_KIND = "nf:bench"; // contrôle master↔worker (le relay l'ignore : pas rt)
const PAD = "x".repeat(Math.max(0, PAYLOAD));

const fmt = (n) => n.toLocaleString("en-US");
const pct = (sorted, p) =>
  sorted.length
    ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
    : 0;

// ───────────────────────────── MASTER (gateway) ─────────────────────────────
if (cluster.isPrimary) {
  const relay = new ClusterRelay();
  const reports = new Map(); // workerId -> report
  let readyCount = 0;
  const subs = WORKERS - 1;

  console.log(
    `cluster-ipc bench — MODE=${MODE} WORKERS=${WORKERS} (1 pub + ${subs} sub) ` +
      `PAYLOAD=${PAYLOAD}B DURATION=${DURATION}s${MODE === "rtt" ? ` RATE=${RATE}/s` : ""}`,
  );

  for (let i = 0; i < WORKERS; i += 1) {
    const role = i === 0 ? "pub" : "sub";
    const w = cluster.fork({ BENCH_ROLE: role });
    // Le VRAI relay route les enveloppes realtime de ce worker vers les autres.
    relay.attach({
      id: w.id,
      send: (m) => w.send(m),
      onMessage: (cb) => w.on("message", cb),
    });
    // Canal de contrôle bench (séparé — le relay ignore BENCH_KIND).
    w.on("message", (m) => {
      if (!m || m.kind !== BENCH_KIND) return;
      if (m.event === "ready") {
        readyCount += 1;
        if (readyCount === WORKERS) start();
      } else if (m.event === "report") {
        reports.set(w.id, m);
        if (reports.size === WORKERS) summarize();
      }
    });
  }

  function start() {
    const cfg = {
      kind: BENCH_KIND,
      event: "start",
      mode: MODE,
      durationMs: DURATION * 1000,
    };
    for (const id of Object.keys(cluster.workers))
      cluster.workers[id].send(cfg);
  }

  function summarize() {
    let received = 0;
    let bytes = 0;
    let published = 0;
    let attempted = 0;
    let rtt = [];
    for (const r of reports.values()) {
      received += r.received || 0;
      bytes += r.bytes || 0;
      published += r.published || 0;
      attempted += r.attempted || 0;
      if (r.rtt) rtt = rtt.concat(r.rtt);
    }
    const secs = DURATION;
    console.log("\n──────── résultats ────────");
    console.log(
      `relay.relayedTotal      : ${fmt(relay.relayedTotal)} publications routées`,
    );
    if (MODE === "throughput") {
      console.log(
        `publisher attempted     : ${fmt(attempted)} (backlog = attempted - published)`,
      );
      console.log(
        `publishes/s (gateway)   : ${fmt(Math.round(relay.relayedTotal / secs))}`,
      );
      console.log(
        `deliveries (fan-out)    : ${fmt(received)} reçues par ${subs} sub`,
      );
      console.log(
        `deliveries/s            : ${fmt(Math.round(received / secs))}`,
      );
      console.log(
        `débit utile             : ${(bytes / secs / 1e6).toFixed(2)} MB/s (payload seul)`,
      );
      console.log(
        `par message             : ${PAYLOAD}B × ${fmt(Math.round(received / secs))}/s`,
      );
    } else {
      rtt.sort((a, b) => a - b);
      console.log(
        `RTT samples             : ${fmt(rtt.length)} (worker→master→worker→master→worker)`,
      );
      console.log(
        `RTT p50 / p99 / max     : ${pct(rtt, 50).toFixed(3)} / ${pct(rtt, 99).toFixed(3)} / ${(rtt[rtt.length - 1] || 0).toFixed(3)} ms`,
      );
      console.log(
        `RTT moyen               : ${(rtt.reduce((a, b) => a + b, 0) / (rtt.length || 1)).toFixed(3)} ms`,
      );
    }
    console.log("───────────────────────────");
    for (const id of Object.keys(cluster.workers)) cluster.workers[id].kill();
    setTimeout(() => process.exit(0), 200);
  }
}

// ───────────────────────────── WORKER (pub | sub) ───────────────────────────
else {
  const role = process.env.BENCH_ROLE;
  const originId = String(process.pid);
  const bp = new ClusterBackplane(processIpcTransport, originId);
  bp.start();

  let received = 0;
  let bytes = 0;
  let published = 0;
  let attempted = 0;
  const rtt = [];
  const inflight = new Map(); // seq -> t0 (mode rtt, publisher)

  bp.onMessage((msg) => {
    if (MODE === "throughput") {
      if (msg.channel === CHANNEL) {
        received += 1;
        bytes += PAYLOAD;
      }
      return;
    }
    // mode rtt
    if (role === "sub" && msg.channel === CHANNEL) {
      // renvoie un pong en re-publiant (le relay le route vers le publisher).
      bp.publish(RETURN, msg.payload);
    } else if (role === "pub" && msg.channel === RETURN) {
      const seq = msg.payload?.seq;
      const t0 = inflight.get(seq);
      if (t0 !== undefined) {
        rtt.push(performance.now() - t0);
        inflight.delete(seq);
      }
    }
  });

  process.on("message", (m) => {
    if (!m || m.kind !== BENCH_KIND || m.event !== "start") return;
    if (role === "pub") {
      runPublisher(m.durationMs); // se rapporte lui-même via finishPub
    } else {
      // sub : passif (compte via onMessage), rapporte à la fin
      setTimeout(report, m.durationMs + 300);
    }
  });

  function runPublisher(durationMs) {
    const end = performance.now() + durationMs;
    let seq = 0;
    if (MODE === "throughput") {
      const tick = () => {
        if (performance.now() >= end) return finishPub();
        for (let i = 0; i < BATCH; i += 1) {
          bp.publish(CHANNEL, { seq: seq++, pad: PAD });
          attempted += 1;
          published += 1; // publish est synchrone côté JS (process.send bufferise)
        }
        setImmediate(tick);
      };
      tick();
    } else {
      // rtt : cadence RATE pings/s
      const intervalMs = 1000 / RATE;
      const timer = setInterval(() => {
        if (performance.now() >= end) {
          clearInterval(timer);
          return finishPub();
        }
        const s = seq++;
        inflight.set(s, performance.now());
        bp.publish(CHANNEL, { seq: s, pad: PAD });
        attempted += 1;
        published += 1;
      }, intervalMs);
    }
    function finishPub() {
      setTimeout(report, 300); // laisse les derniers pongs/livraisons arriver
    }
  }

  function report() {
    process.send({
      kind: BENCH_KIND,
      event: "report",
      role,
      received,
      bytes,
      published,
      attempted,
      rtt: role === "pub" && MODE === "rtt" ? rtt : undefined,
    });
  }

  process.send({ kind: BENCH_KIND, event: "ready" });
}
