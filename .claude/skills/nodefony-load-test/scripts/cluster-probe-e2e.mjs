// Preuve BOUT-EN-BOUT de la SONDE AGRÉGÉE pod (cluster sans PM2) — Phase 4c, mode push.
//
// Assemble les VRAIS composants et `fork` un cluster Node natif pour prouver que la vue
// POD (santé de TOUS les workers) se construit cross-process, par PUSH :
//
//   worker A/B : ClusterProbeClient → process.send (nf:probe, sa santé per-instance)
//     → MASTER ClusterProbeAggregator collecte (Map workerId→sonde)
//       → broadcast périodique (nf:probe:snap, liste de TOUTES les sondes) vers chaque worker
//         → worker met en cache → getClusterHealth() = vue POD agrégée (instanceCount + totals)
//
// Chaque worker enregistre un nombre DISTINCT de connexions (A=2, B=3) sur son hub ; on
// asserte (exit 0/1) que les DEUX workers voient la même vue pod : instanceCount=2,
// connectionCount agrégé = 5. Prouve la collecte + l'agrégation + le push + le merge.
//
// Prérequis : `npm run build` (core + framework). Lancement (racine repo) :
//   node .claude/skills/nodefony-load-test/scripts/cluster-probe-e2e.mjs
import cluster from "node:cluster";
import process from "node:process";
import { ClusterRelay, ClusterProbeAggregator } from "nodefony";
import {
  RealtimeHub,
  ClusterProbeClient,
  processProbeTransport,
} from "@nodefony/framework";

const CTRL = "nf:e2e";
const SETTLE_MS = Number(process.env.SETTLE || 800); // ≥ quelques cycles report+broadcast
const TICK_MS = 150; // cadence report (worker) et broadcast (master)
const CONNS = { A: 2, B: 3 }; // connexions enregistrées par worker → totals attendus = 5

// ───────────────────────────── MASTER (gateway) ─────────────────────────────
if (cluster.isPrimary) {
  const relay = new ClusterRelay();
  const probes = new ClusterProbeAggregator({ intervalMs: TICK_MS });
  const pods = new Map(); // role -> { instanceCount, connTotal }
  let ready = 0;

  console.log(
    "cluster-probe-e2e — 2 workers (A, B), master = ClusterProbeAggregator (push)\n",
  );

  for (const role of ["A", "B"]) {
    const w = cluster.fork({ E2E_ROLE: role });
    const handle = {
      id: w.id,
      send: (m) => w.send(m),
      onMessage: (cb) => w.on("message", cb),
    };
    relay.attach(handle);
    probes.attach(handle);
    w.on("message", (m) => {
      if (!m || m.kind !== CTRL) return;
      if (m.event === "ready") {
        ready += 1;
        if (ready === 2) setTimeout(checkpoint, SETTLE_MS);
      } else if (m.event === "pod") {
        pods.set(m.role, m.view);
        if (pods.size === 2) finish();
      }
    });
  }
  probes.start(); // diffusion périodique du snapshot agrégé

  function checkpoint() {
    for (const id in cluster.workers)
      cluster.workers[id].send({ kind: CTRL, event: "checkpoint" });
  }

  function finish() {
    const A = pods.get("A");
    const B = pods.get("B");
    const checks = [
      ["worker A voit les 2 instances du pod", A.instanceCount === 2],
      ["worker B voit les 2 instances du pod", B.instanceCount === 2],
      ["worker A agrège connectionCount = 5 (2+3)", A.connTotal === 5],
      ["worker B agrège connectionCount = 5 (2+3)", B.connTotal === 5],
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
      `\n${ok ? "PASS — sonde agrégée pod vérifiée bout-en-bout (push)" : "FAIL — voir ❌"}`,
    );
    console.log("  A =", JSON.stringify(A), "| B =", JSON.stringify(B));
    probes.clear();
    for (const id in cluster.workers) cluster.workers[id].kill();
    setTimeout(() => process.exit(ok ? 0 : 1), 150);
  }
}

// ───────────────────────────── WORKER (A | B) ───────────────────────────────
else {
  const role = process.env.E2E_ROLE;
  const hub = new RealtimeHub();
  // Enregistre N connexions factices → la sonde reflète un connectionCount distinct.
  for (let i = 0; i < CONNS[role]; i += 1) {
    hub.registerConnection({
      readyState: 1,
      bufferedAmount: 0,
      bytesSent: 0,
      messagesSent: 0,
    });
  }
  const client = new ClusterProbeClient(processProbeTransport, TICK_MS);
  client.start(() => ({ instanceId: role, ...hub.probe() }));

  process.on("message", (m) => {
    if (!m || m.kind !== CTRL || m.event !== "checkpoint") return;
    const pod = client.getClusterHealth();
    process.send({
      kind: CTRL,
      event: "pod",
      role,
      view: pod
        ? {
            instanceCount: pod.instanceCount,
            connTotal: pod.totals.connectionCount,
          }
        : { instanceCount: 0, connTotal: 0 },
    });
  });

  process.send({ kind: CTRL, event: "ready" });
}
