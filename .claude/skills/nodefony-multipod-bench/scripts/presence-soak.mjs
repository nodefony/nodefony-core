/**
 * Soak de la PRÉSENCE répartie (ADR-0025, #760 étape 5) : des onglets RÉELS
 * (`NodefonySocket` du `dist` de l'application) arrivent et repartent sans
 * arrêt sur `nodefony cluster -w N` — les workers se partagent le port, donc
 * chaque onglet tombe sur un worker que personne ne choisit. Toutes les
 * `--every` secondes la charge se FIGE et le banc exige que TOUS les onglets
 * s'accordent sur le compte exact, vue complète. Il relève aussi ce qui dit
 * « ça ne tient pas » : compteurs de la sonde (refus, rejeux, oublis, bus
 * perdu, trous), erreurs d'ouverture côté client, lignes ERROR/CRITIC du
 * journal, et la mémoire de chaque worker dans le temps.
 *
 *   node presence-soak.mjs [--minutes 60] [--workers 2] [--driver cluster|redis]
 *                          [--max 40] [--every 30] [--port 5197]
 *
 * Verdict : exit 0 seulement si chaque point de contrôle a convergé, aucun
 * compteur d'erreur n'a bougé, et la mémoire est restée plate.
 */
import { spawn, execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { arg, dormir, ecoute, jusqua, rapporteur } from "./lib/pod.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const app = path.resolve(here, arg("app", "appalpha"));
const minutes = Number(arg("minutes", "60"));
const workers = Number(arg("workers", "2"));
const driver = arg("driver", "cluster");
const maxTabs = Number(arg("max", "40"));
const everyMs = Number(arg("every", "30")) * 1000;
const port = Number(arg("port", "5197"));
const LOBBY = "chat:lobby";
const GRACE_MS = 2000; // celle du canal (references/controller.md)
const WATCHERS = 4;

const { NodefonySocket } = await import(
  pathToFileURL(
    path.join(app, "node_modules/nodefony/dist/client/client/index.js"),
  ).href
);

const r = rapporteur();
const clientErrors = [];
process.on("unhandledRejection", (e) =>
  clientErrors.push(`rejet : ${String(e)}`),
);

// ── Le runtime : un maître, N workers, le driver choisi ─────────────────────
if (await ecoute(port)) {
  console.error(
    `port ${port} déjà à l'écoute — identifier le process avant tout geste`,
  );
  process.exit(2);
}
const log = [];
const master = spawn(
  process.execPath,
  [
    path.join(app, "node_modules/nodefony/bin/nodefony"),
    "cluster",
    "--workers",
    String(workers),
  ],
  {
    cwd: app,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      NODE_ENV: "production",
      NF_PORT: String(port),
      NF_PORT_HTTPS: String(port + 1),
      NF_REALTIME_DRIVER: driver,
      NF_REDIS_URL:
        process.env.NF_REDIS_URL ?? "redis://:nodefony-dev@127.0.0.1:6379",
      NF_REALTIME_BACKPLANE_SECRET: "bench-secret-0123456789abcdefghij",
    },
  },
);
master.stdout.on("data", (d) => log.push(String(d)));
master.stderr.on("data", (d) => log.push(String(d)));

/** Tous les process du runtime (maître + descendants), RSS en Ko. */
function tree() {
  const rows = execFileSync("ps", ["-A", "-o", "pid=,ppid=,rss="], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .map((l) => l.trim().split(/\s+/).map(Number));
  const kids = new Map();
  for (const [pid, ppid, rss] of rows) {
    if (!kids.has(ppid)) kids.set(ppid, []);
    kids.get(ppid).push({ pid, rss });
  }
  const out = [];
  const walk = (pid) => {
    for (const k of kids.get(pid) ?? []) {
      out.push(k);
      walk(k.pid);
    }
  };
  walk(master.pid);
  return out;
}

/** Un onglet réel, abonné au salon. */
function tab() {
  const socket = new NodefonySocket({
    url: `ws://127.0.0.1:${port}/api/chat/realtime`,
  });
  const t = { socket, snapshot: null };
  socket.onPresence(LOBBY, (s) => {
    t.snapshot = s;
  });
  socket
    .connect()
    .catch((e) =>
      clientErrors.push(e instanceof Error ? e.message : String(e)),
    );
  socket.subscribe(LOBBY);
  return t;
}
const seenTotal = (t) =>
  t.snapshot?.ready === true ? t.snapshot.count + t.snapshot.unnamed : -1;

/** La sonde d'UN worker (le port les répartit) : on interroge plusieurs fois. */
async function probes() {
  const byPod = new Map();
  for (let i = 0; i < workers * 6; i++) {
    try {
      const p = await (
        await fetch(`http://127.0.0.1:${port}/api/chat/probe`)
      ).json();
      byPod.set(p.pod, p.presenceProbe ?? {});
    } catch {
      /* worker en redémarrage : vu au compteur d'erreurs du journal */
    }
  }
  return byPod;
}
const ERROR_FIELDS = [
  "presenceRejectedTotal",
  "presenceStaleDiscardedTotal",
  "forgottenTotal",
  "busLostTotal",
];

const watchers = [];
const churn = [];
const checkpoints = [];
const memory = [];
const pids = [];

try {
  const up = await jusqua(
    async () => (await ecoute(port)) && tree().length >= workers,
    90_000,
  );
  if (!up)
    throw new Error(
      `le runtime n'a jamais écouté sur ${port}\n${log.join("").slice(-2000)}`,
    );
  await dormir(3000); // tous les workers en service (le port répond dès le premier)
  console.log(
    `>>> cluster de ${workers} workers, driver ${driver}, ${minutes} min, ≤ ${maxTabs} onglets`,
  );
  for (let i = 0; i < WATCHERS; i++) watchers.push(tab());

  const t0 = performance.now();
  const end = t0 + minutes * 60_000;
  let next = t0 + everyMs;
  let arrivals = 0;
  let departures = 0;
  while (performance.now() < end) {
    // Arrivées et départs au hasard, et un peu de frappe.
    if (
      churn.length < maxTabs &&
      (churn.length === 0 || Math.random() < 0.55)
    ) {
      churn.push(tab());
      arrivals++;
    } else if (churn.length > 0) {
      churn
        .splice(Math.floor(Math.random() * churn.length), 1)[0]
        .socket.disconnect();
      departures++;
    }
    if (churn.length > 0 && Math.random() < 0.2)
      churn[Math.floor(Math.random() * churn.length)].socket.emit(
        "chat:typing",
        { author: "soak" },
      );
    await dormir(100 + Math.random() * 200);

    if (performance.now() >= next) {
      next += everyMs;
      // Charge FIGÉE : tous les onglets doivent converger vers le compte exact.
      const all = [...watchers, ...churn];
      const expected = all.length;
      const c0 = performance.now();
      const converged = await jusqua(
        async () =>
          all.every(
            (t) => seenTotal(t) === expected && t.snapshot.partial === false,
          ),
        GRACE_MS + 10_000,
      );
      const ms = Math.round(performance.now() - c0);
      const off = all.filter((t) => seenTotal(t) !== expected).map(seenTotal);
      const procs = tree();
      const rss = procs.map((p) => Math.round(p.rss / 1024));
      pids.push(procs.map((p) => p.pid).join(","));
      const elapsed = Math.round((performance.now() - t0) / 60_000);
      checkpoints.push({
        elapsed,
        expected,
        converged,
        ms,
        off: off.slice(0, 5),
      });
      memory.push(rss);
      console.log(
        `  ${converged ? "✔" : "✘"} t=${elapsed} min : ${expected} présents, ${converged ? `accord en ${ms} ms` : `DÉSACCORD ${JSON.stringify(off.slice(0, 5))}`} · arrivées ${arrivals}, départs ${departures} · RSS ${procs.map((p) => `${p.pid}:${Math.round(p.rss / 1024)}`).join(" ")} Mo`,
      );
    }
  }

  // ── Verdict ────────────────────────────────────────────────────────────────
  const failed = checkpoints.filter((c) => !c.converged);
  r.dire(
    checkpoints.length > 0 && failed.length === 0,
    `${checkpoints.length} points de contrôle, ${failed.length} sans accord`,
  );
  const byPod = await probes();
  r.dire(
    byPod.size === workers,
    `sonde lue sur ${byPod.size}/${workers} workers`,
  );
  for (const [pod, p] of byPod) {
    const bad = ERROR_FIELDS.filter((f) => (p[f] ?? 0) !== 0).map(
      (f) => `${f}=${p[f]}`,
    );
    r.dire(
      bad.length === 0,
      `worker ${pod} : ${bad.length === 0 ? "aucun compteur d'erreur" : bad.join(", ")} · trous ${p.gapTotal ?? 0}, lots ${p.batchTotal ?? 0}, demandes ${p.requestTotal ?? 0}`,
    );
  }
  r.dire(
    clientErrors.length === 0,
    `erreurs côté client : ${clientErrors.length}${clientErrors.length ? ` (${clientErrors.slice(0, 3).join(" | ")})` : ""}`,
  );
  const errorLines = log
    .join("")
    .replace(/\x1b\[[0-9;]*m/g, "")
    .split("\n")
    .filter((l) => / (ERROR|CRITIC) /.test(l));
  r.dire(
    errorLines.length === 0,
    `journal : ${errorLines.length} ligne(s) ERROR/CRITIC${errorLines.length ? `\n      ${errorLines.slice(0, 5).join("\n      ")}` : ""}`,
  );
  // Mémoire : la moyenne du dernier quart contre celle du deuxième (le premier
  // quart porte la montée du JIT et des caches).
  r.dire(
    new Set(pids).size <= 1,
    `mêmes process du début à la fin (${[...new Set(pids)].join(" → ")})`,
  );
  if (memory.length >= 8) {
    const q = Math.floor(memory.length / 4);
    const mean = (rows, w) =>
      rows.reduce((s, row) => s + (row[w] ?? 0), 0) / rows.length;
    for (let w = 0; w < memory[0].length; w++) {
      const early = mean(memory.slice(q, 2 * q), w);
      const late = mean(memory.slice(-q), w);
      const growth = early > 0 ? (late - early) / early : 0;
      r.dire(
        growth < 0.1,
        `process ${w} : RSS ${Math.round(early)} → ${Math.round(late)} Mo (${(growth * 100).toFixed(1)} %)`,
      );
    }
  } else {
    console.log(
      "  (mémoire : trop peu de points pour juger une pente — run trop court)",
    );
  }
} catch (error) {
  r.dire(
    false,
    `banc interrompu : ${error instanceof Error ? error.message : String(error)}`,
  );
} finally {
  for (const t of [...watchers, ...churn]) t.socket.disconnect();
  try {
    process.kill(master.pid, "SIGTERM");
  } catch {
    /* déjà parti */
  }
  const gone = await jusqua(async () => !(await ecoute(port)), 15_000);
  if (!gone)
    for (const p of tree())
      try {
        process.kill(p.pid, "SIGKILL");
      } catch {
        /* parti */
      }
  try {
    process.kill(master.pid, "SIGKILL");
  } catch {
    /* parti */
  }
}
process.exit(r.verdict());
