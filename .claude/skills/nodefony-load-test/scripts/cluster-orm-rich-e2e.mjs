// Preuve BOUT-EN-BOUT du RELAIS ORM RICHE @pid (drill cluster, facette "orm") — sans navigateur.
//
// Vérifie que le diagnostic ORM riche d'un worker EXACT (≠ round-robin) remonte cross-process
// jusqu'au worker qui tient la connexion navigateur, à la demande, et se coupe à l'arrêt :
//
//   worker A (tient le navigateur) : clusterProbeRequestEnrich(pidB, true, "orm")  → nf:probe:ctl
//     → MASTER ClusterProbeAggregator route l'ordre (facette "orm") vers le worker B → nf:probe:enrich
//       → worker B : ClusterProbeClient active sa sonde ORM riche (seam setOrmRichProvider) → joint
//          `ormRich` à son report → snapshot agrégé → cache de A
//         → A : clusterProbeInstance(pidB).ormRich === blob de B (EXACT, pas un autre worker)
//   puis A : clusterProbeRequestEnrich(pidB, false, "orm") → B coupe → ormRich disparaît du snapshot.
//
// Chaque worker publie un blob ORM riche MARQUÉ de son rôle → on prouve que A reçoit bien CELUI de B
// (pas le sien, pas celui d'un autre). Asserte (exit 0/1).
//
// Prérequis : `npm run build` (core + framework). Lancement (racine repo) :
//   node .claude/skills/nodefony-load-test/scripts/cluster-orm-rich-e2e.mjs
import cluster from "node:cluster";
import process from "node:process";
import { ClusterProbeAggregator, setOrmRichProvider } from "nodefony";
import {
  RealtimeHub,
  ClusterProbeClient,
  processProbeTransport,
  setClusterProbeClient,
  clusterProbeRequestEnrich,
  clusterProbeInstance,
} from "@nodefony/realtime";

const CTRL = "nf:e2e";
const TICK_MS = 120; // cadence report (worker) + broadcast (master) + cache ORM riche
const SETTLE_MS = Number(process.env.SETTLE || 1200); // ≥ plusieurs cycles (enrich async)

// ───────────────────────────── MASTER (gateway) ─────────────────────────────
if (cluster.isPrimary) {
  const probes = new ClusterProbeAggregator({ intervalMs: TICK_MS });
  const pidByRole = {};
  const results = {};
  let ready = 0;

  console.log(
    "cluster-orm-rich-e2e — 2 workers (A tient le navigateur, B est drillé)\n",
  );

  for (const role of ["A", "B"]) {
    const w = cluster.fork({ E2E_ROLE: role });
    pidByRole[role] = w.process.pid;
    const handle = {
      id: w.id,
      pid: w.process.pid, // ⚠️ clé de ciblage du drill (#byPid) — absente du e2e sonde simple
      send: (m) => w.send(m),
      onMessage: (cb) => w.on("message", cb),
    };
    probes.attach(handle);
    w.on("message", (m) => {
      if (!m || m.kind !== CTRL) return;
      if (m.event === "ready") {
        ready += 1;
        if (ready === 2) setTimeout(startDrill, SETTLE_MS);
      } else if (m.event === "result") {
        results[m.phase] = m.ormRich;
        if (m.phase === "drilled") afterDrill();
        else if (m.phase === "stopped") finish();
      }
    });
  }
  probes.start();

  // Phase 1 : A drille le pid de B (facette orm) → on attend la propagation → checkpoint.
  function startDrill() {
    cluster.workers[workerIdOfRole("A")].send({
      kind: CTRL,
      event: "drill",
      pid: pidByRole.B,
    });
    setTimeout(
      () =>
        cluster.workers[workerIdOfRole("A")].send({
          kind: CTRL,
          event: "checkpoint",
          phase: "drilled",
        }),
      SETTLE_MS,
    );
  }

  // Phase 2 : A arrête le drill → on attend → checkpoint (ormRich doit disparaître).
  function afterDrill() {
    cluster.workers[workerIdOfRole("A")].send({
      kind: CTRL,
      event: "undrill",
      pid: pidByRole.B,
    });
    setTimeout(
      () =>
        cluster.workers[workerIdOfRole("A")].send({
          kind: CTRL,
          event: "checkpoint",
          phase: "stopped",
        }),
      SETTLE_MS,
    );
  }

  function workerIdOfRole(role) {
    for (const id in cluster.workers)
      if (cluster.workers[id].process.pid === pidByRole[role]) return id;
    return undefined;
  }

  function finish() {
    const drilled = results.drilled;
    const stopped = results.stopped;
    const checks = [
      ["A reçoit un ormRich pour le pid EXACT de B", !!drilled],
      [
        "le ormRich est bien celui de B (marker 'B', pas A)",
        !!drilled && drilled.marker === "B",
      ],
      [
        "le blob porte santé + flux ORM (health[] + flow)",
        !!drilled && Array.isArray(drilled.health) && !!drilled.flow,
      ],
      ["après stop, l'ormRich du pid disparaît (on ne paie plus)", !stopped],
    ];
    let ok = true;
    for (const [label, pass] of checks) {
      console.log(`  ${pass ? "✅" : "❌"} ${label}`);
      if (!pass) ok = false;
    }
    console.log(
      `\n  drilled = ${JSON.stringify(drilled)}\n  stopped = ${JSON.stringify(stopped)}`,
    );
    console.log(
      `\n${ok ? "PASS — relais ORM riche @pid vérifié bout-en-bout (cross-process)" : "FAIL — voir ❌"}`,
    );
    probes.clear();
    for (const id in cluster.workers) cluster.workers[id].kill();
    setTimeout(() => process.exit(ok ? 0 : 1), 150);
  }
}

// ───────────────────────────── WORKER (A | B) ───────────────────────────────
else {
  const role = process.env.E2E_ROLE;
  // Blob ORM riche MARQUÉ du rôle (forme { health[], flow } comme le vrai provider Drizzle).
  setOrmRichProvider(async () => ({
    marker: role,
    health: [
      { name: "default", pingOk: true, instanceId: String(process.pid) },
    ],
    flow: { ts: Date.now(), connectors: [] },
  }));

  const hub = new RealtimeHub();
  const client = new ClusterProbeClient(processProbeTransport, TICK_MS);
  setClusterProbeClient(client); // active les helpers clusterProbeInstance/RequestEnrich
  client.start(() => ({ instanceId: String(process.pid), ...hub.probe() }));

  let drilledPid = 0;
  process.on("message", (m) => {
    if (!m || m.kind !== CTRL) return;
    if (m.event === "drill") {
      drilledPid = m.pid;
      clusterProbeRequestEnrich(drilledPid, true, "orm");
    } else if (m.event === "undrill") {
      clusterProbeRequestEnrich(drilledPid, false, "orm");
    } else if (m.event === "checkpoint") {
      const inst = clusterProbeInstance(drilledPid);
      process.send({
        kind: CTRL,
        event: "result",
        phase: m.phase,
        ormRich: inst?.ormRich ?? null,
      });
    }
  });

  process.send({ kind: CTRL, event: "ready" });
}
