// Preuve BOUT-EN-BOUT du realtime cross-process Nodefony (cluster sans PM2) — Phase 4b.
//
// Assemble les VRAIS composants livrés (Phase 3 + 4a) et `fork` un cluster Node natif
// pour prouver le chemin complet d'une publication realtime entre deux workers :
//
//   worker B : hub.publish("chat:room")           (broadcast, opt-in)
//     → ClusterBackplane.publish → process.send (IPC, kind nf:rt)
//       → MASTER ClusterRelay #route → rebroadcast aux AUTRES workers (exclut B)
//         → worker A : ClusterBackplane #ingress (anti-echo originId) → hub.publishLocal
//           → fan-out au sink abonné de A    ✅ reçu
//
// Différent de `cluster-ipc.mjs` (qui benche le FIL IPC nu) : ici on monte le RealtimeHub
// complet + la politique de forward PAR CANAL (4a) et on ASSERTE le comportement (exit 0/1) :
//
//   1. broadcast cross-process : A reçoit le chat de B, et B reçoit le chat de A.
//   2. anti-echo               : l'auteur reçoit son propre chat UNE seule fois (fan-out
//                                local), jamais re-livré par l'aller-retour relay.
//   3. politique instance-local: un canal NON déclaré broadcast (`realtime:health`) ne
//                                traverse PAS le backplane → A ne reçoit jamais la santé de B.
//   4. fan-out local intact    : l'auteur reçoit bien sa propre santé (publish local).
//
// Prérequis : `npm run build` (core + framework) — importe les dist.
// Lancement (depuis la racine repo) :
//   node .claude/skills/nodefony-load-test/scripts/cluster-realtime-e2e.mjs
import cluster from "node:cluster";
import process from "node:process";
import { ClusterRelay } from "nodefony";
import {
  RealtimeHub,
  ClusterBackplane,
  processIpcTransport,
} from "@nodefony/realtime";

const CTRL = "nf:e2e"; // kind de contrôle master↔worker (le relay l'ignore : pas rt)
const SETTLE_MS = Number(process.env.SETTLE || 600); // attente des allers-retours IPC
const CHAT = "chat:room"; // canal BROADCAST (déclaré opt-in)
const HEALTH = "realtime:health"; // canal INSTANCE-LOCAL (jamais forwardé)

// ───────────────────────────── MASTER (gateway) ─────────────────────────────
if (cluster.isPrimary) {
  const relay = new ClusterRelay();
  const reports = new Map(); // role -> { chat, health }
  let ready = 0;

  console.log(
    "cluster-realtime-e2e — 2 workers (A, B), master = ClusterRelay\n",
  );

  for (const role of ["A", "B"]) {
    const w = cluster.fork({ E2E_ROLE: role });
    relay.attach({
      id: w.id,
      send: (m) => w.send(m),
      onMessage: (cb) => w.on("message", cb),
    });
    w.on("message", (m) => {
      if (!m || m.kind !== CTRL) return;
      if (m.event === "ready") {
        ready += 1;
        if (ready === 2)
          for (const id in cluster.workers)
            cluster.workers[id].send({ kind: CTRL, event: "go" });
      } else if (m.event === "report") {
        reports.set(m.role, m.recv);
        if (reports.size === 2) finish();
      }
    });
  }

  function finish() {
    const A = reports.get("A");
    const B = reports.get("B");
    const checks = [
      ["broadcast cross-process : A reçoit le chat de B", A.chat.B === 1],
      ["broadcast cross-process : B reçoit le chat de A", B.chat.A === 1],
      [
        "anti-echo : A reçoit SON chat 1× (fan-out local, pas de boucle)",
        A.chat.A === 1,
      ],
      [
        "anti-echo : B reçoit SON chat 1× (fan-out local, pas de boucle)",
        B.chat.B === 1,
      ],
      [
        "politique : A ne reçoit PAS la santé (instance-local) de B",
        A.health.B === 0,
      ],
      [
        "politique : B ne reçoit PAS la santé (instance-local) de A",
        B.health.A === 0,
      ],
      ["fan-out local : A reçoit SA santé", A.health.A === 1],
      ["fan-out local : B reçoit SA santé", B.health.B === 1],
    ];
    let ok = true;
    for (const [label, pass] of checks) {
      console.log(`  ${pass ? "✅" : "❌"} ${label}`);
      if (!pass) ok = false;
    }
    console.log(
      `\n  relay.relayedTotal = ${relay.relayedTotal} (publications routées par le master)`,
    );
    console.log(
      `\n${ok ? "PASS — realtime cross-process bout-en-bout vérifié" : "FAIL — voir ❌ ci-dessus"}`,
    );
    console.log("  A =", JSON.stringify(A), "| B =", JSON.stringify(B));
    for (const id in cluster.workers) cluster.workers[id].kill();
    setTimeout(() => process.exit(ok ? 0 : 1), 150);
  }
}

// ───────────────────────────── WORKER (A | B) ───────────────────────────────
else {
  const role = process.env.E2E_ROLE; // "A" | "B"
  const hub = new RealtimeHub();
  hub.setBackplane(
    new ClusterBackplane(processIpcTransport, String(process.pid)),
  );
  hub.markBroadcastChannel("chat:"); // opt-in cross-process (couvre la cadence :<ms>)

  // Compte les réceptions par auteur (champ `from` du payload), par canal.
  const recv = { chat: { A: 0, B: 0 }, health: { A: 0, B: 0 } };
  const reg = (channel, bucket) =>
    hub.subscribe(
      channel,
      (p) => {
        if (p && (p.from === "A" || p.from === "B")) bucket[p.from] += 1;
      },
      () => () => {},
    );
  reg(CHAT, recv.chat);
  reg(HEALTH, recv.health); // abonné localement → SI la santé de l'autre arrivait, on la verrait

  process.on("message", (m) => {
    if (!m || m.kind !== CTRL || m.event !== "go") return;
    // publie UNE charge sur chaque canal, taguée du rôle de ce worker.
    hub.publish(CHAT, { from: role });
    hub.publish(HEALTH, { from: role });
    // laisse les allers-retours IPC se terminer, puis rapporte.
    setTimeout(
      () => process.send({ kind: CTRL, event: "report", role, recv }),
      SETTLE_MS,
    );
  });

  process.send({ kind: CTRL, event: "ready" });
}
