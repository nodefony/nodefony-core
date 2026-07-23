// Preuve BOUT-EN-BOUT de la forme JSON de l'ENDPOINT santé en mode cluster — ce que le
// panneau Studio « Realtime Hub » (vue pod) consomme réellement.
//
// `fork` un cluster Node natif et, sur CHAQUE worker, appelle la VRAIE fonction
// `buildRealtimeHealth()` (= le handler de `GET /nodefony/realtime/api/health` et du canal
// `realtime:health`). En cluster avec sonde active, elle renvoie `IRealtimeClusterHealth`
// (`cluster:true`, `instanceCount`, `instances[]`, `totals`) au lieu de `IRealtimeHealth`.
//
//   worker A/B : getRealtimeHub() + N connexions ; ClusterProbeClient.start(buildOwnHealth)
//     → process.send (sonde per-instance) → MASTER ClusterProbeAggregator collecte
//       → broadcast (snapshot agrégé) → worker cache → buildRealtimeHealth() = vue POD
//
// Asserte (exit 0/1) que l'endpoint d'un worker renvoie bien la vue pod : cluster===true,
// instanceCount===2, totals.connectionCount===5 (A=2 + B=3), et que chaque entrée de
// `instances[]` porte la forme per-instance attendue (instanceId, channels[], backpressure).
//
// Prérequis : `npm run build` (core + framework). Lancement (racine repo) :
//   node .claude/skills/nodefony-load-test/scripts/cluster-health-endpoint-e2e.mjs
import cluster from "node:cluster";
import process from "node:process";
import { ClusterProbeAggregator } from "nodefony";
import {
  getRealtimeHub,
  ClusterProbeClient,
  setClusterProbeClient,
  processProbeTransport,
  buildRealtimeHealth,
  buildOwnHealth,
} from "@nodefony/realtime";

const CTRL = "nf:e2e";
const SETTLE_MS = Number(process.env.SETTLE || 800); // ≥ quelques cycles report+broadcast
const TICK_MS = 150; // cadence report (worker) et broadcast (master)
const CONNS = { A: 2, B: 3 }; // connexions par worker → totals.connectionCount attendu = 5

// ───────────────────────────── MASTER (gateway) ─────────────────────────────
if (cluster.isPrimary) {
  const probes = new ClusterProbeAggregator({ intervalMs: TICK_MS });
  const pods = new Map(); // role -> health (sortie de buildRealtimeHealth côté worker)
  let ready = 0;

  console.log(
    "cluster-health-endpoint-e2e — 2 workers (A, B), master = ClusterProbeAggregator (push)\n",
  );

  for (const role of ["A", "B"]) {
    const w = cluster.fork({ E2E_ROLE: role });
    probes.attach({
      id: w.id,
      send: (m) => w.send(m),
      onMessage: (cb) => w.on("message", cb),
    });
    w.on("message", (m) => {
      if (!m || m.kind !== CTRL) return;
      if (m.event === "ready") {
        ready += 1;
        if (ready === 2) setTimeout(checkpoint, SETTLE_MS);
      } else if (m.event === "pod") {
        pods.set(m.role, m.health);
        if (pods.size === 2) finish();
      }
    });
  }
  probes.start();

  function checkpoint() {
    for (const id in cluster.workers)
      cluster.workers[id].send({ kind: CTRL, event: "checkpoint" });
  }

  function finish() {
    const A = pods.get("A");
    const B = pods.get("B");
    const shapeOk = (h) =>
      h &&
      h.cluster === true &&
      h.instanceCount === 2 &&
      Array.isArray(h.instances) &&
      h.instances.length === 2 &&
      h.instances.every(
        (i) =>
          typeof i.instanceId === "string" &&
          Array.isArray(i.channels) &&
          i.backpressure &&
          typeof i.connectionCount === "number",
      ) &&
      h.totals &&
      typeof h.totals.connectionCount === "number";

    const checks = [
      [
        "worker A : endpoint renvoie la vue POD (cluster:true, 2 instances)",
        shapeOk(A),
      ],
      [
        "worker B : endpoint renvoie la vue POD (cluster:true, 2 instances)",
        shapeOk(B),
      ],
      [
        "worker A : totals.connectionCount agrégé = 5 (2+3)",
        A?.totals?.connectionCount === 5,
      ],
      [
        "worker B : totals.connectionCount agrégé = 5 (2+3)",
        B?.totals?.connectionCount === 5,
      ],
      [
        "les 2 workers servent le MÊME instanceCount",
        A?.instanceCount === B?.instanceCount,
      ],
    ];
    let ok = true;
    for (const [label, pass] of checks) {
      console.log(`  ${pass ? "✅" : "❌"} ${label}`);
      if (!pass) ok = false;
    }

    console.log(
      `\n  probes.broadcastTotal = ${probes.broadcastTotal} snapshots diffusés`,
    );
    console.log(
      "\n  JSON exact servi par l'endpoint (worker A) — ce que le front consomme :",
    );
    console.log(JSON.stringify(A, null, 2));
    console.log(
      `\n${ok ? "PASS — l'endpoint santé renvoie IRealtimeClusterHealth en cluster (vue pod)" : "FAIL — voir ❌"}`,
    );

    probes.clear();
    for (const id in cluster.workers) cluster.workers[id].kill();
    setTimeout(() => process.exit(ok ? 0 : 1), 150);
  }
}

// ───────────────────────────── WORKER (A | B) ───────────────────────────────
else {
  const role = process.env.E2E_ROLE;
  // Reproduit le câblage worker de `Framework.#wireCluster` : hub singleton + sonde branchée.
  const hub = getRealtimeHub();
  for (let i = 0; i < CONNS[role]; i += 1) {
    hub.registerConnection({
      readyState: 1,
      bufferedAmount: 0,
      bytesSent: 0,
      messagesSent: 0,
    });
  }
  setClusterProbeClient(
    new ClusterProbeClient(processProbeTransport, TICK_MS),
  ).start(buildOwnHealth);

  process.on("message", async (m) => {
    if (!m || m.kind !== CTRL || m.event !== "checkpoint") return;
    // VRAI handler de l'endpoint santé : clusterProbeHealth() ?? buildOwnHealth().
    const health = await buildRealtimeHealth();
    process.send({ kind: CTRL, event: "pod", role, health });
  });

  process.send({ kind: CTRL, event: "ready" });
}
