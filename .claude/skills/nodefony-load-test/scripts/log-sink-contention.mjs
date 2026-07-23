#!/usr/bin/env node
/**
 * Microbench ISOLÉ du driver de sink de log (LB.W / axe W2).
 *
 * BUT — prouver/chiffrer, SANS le bruit du RPS HTTP cluster (variance ±30 % sur
 * cette machine : load-gen co-localisé + throttling i9 mobile), que :
 *   W2  fd-PAR-worker SYNC supprime la contention d'inode du fd PARTAGÉ (O_APPEND).
 *   W1  l'écriture async (threadpool) n'aide PAS sur fichier local rapide vs sync.
 *
 * Mesure CPU+I/O bound, déterministe, court → quasi insensible au bruit réseau.
 * N process (≈ cluster réel) écrivent chacun K lignes le plus vite possible ;
 * une BARRIÈRE IPC (ready→go) exclut le coût de spawn/boot Node du chrono.
 * Wall = du « go » au dernier « done » = débit AGRÉGÉ du système sous contention.
 *
 * 5 variantes :
 *   null               sink noop (NULL_LOG_SINK)        → plafond CPU (boucle+format)
 *   stdout-shared      fd 1 HÉRITÉ partagé (writeSync 1) → cluster HISTORIQUE
 *   file-shared-sync   openSync MÊME path "a", writeSync → contention inode PURE
 *   file-perworker-sync  openSync path PROPRE "a", writeSync → W2 (FileSink sync)
 *   file-perworker-async buffer + fs.write 1-en-vol, path PROPRE → W1 (FileSink défaut)
 *
 * Comparaisons clés : shared-sync↔perworker-sync = gain CONTENTION (sync constant) ;
 *                     perworker-sync↔perworker-async = overhead THREADPOOL async.
 *
 * À lancer depuis la RACINE du repo :
 *   node .claude/skills/nodefony-load-test/scripts/log-sink-contention.mjs
 *   WORKERS=6 LINES=150000 RUNS=7 node .../log-sink-contention.mjs
 *
 * ENV : WORKERS (def 6 = cœurs phys) · LINES (def 150000 /worker) · RUNS (def 7,
 *       médiane) · WARMUP (def 1, jeté) · ONLY (csv variantes) · KEEP=1 (garder fichiers)
 */
import {
  openSync,
  writeSync,
  closeSync,
  write as fsWrite,
  ftruncateSync,
  unlinkSync,
  statSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SELF = fileURLToPath(import.meta.url);
const WORKERS = Number(process.env.WORKERS ?? 6);
const LINES = Number(process.env.LINES ?? 150000);
const RUNS = Number(process.env.RUNS ?? 7);
const WARMUP = Number(process.env.WARMUP ?? 1);
const DIR = tmpdir();
const SHARED = join(DIR, "nf-sink-bench-shared.log");
const perworkerPath = (wid) => join(DIR, `nf-sink-bench-w${wid}.log`);
const STDOUT_FILE = join(DIR, "nf-sink-bench-stdout.log");

const ALL = [
  "null",
  "stdout-shared",
  "file-shared-sync",
  "file-shared-sync-batch",
  "file-perworker-sync",
  "file-perworker-sync-batch",
  "file-perworker-async",
];
const BATCH = 64 * 1024; // octets accumulés avant 1 writeSync (modélise la coalescence par tick du Syslog)
const VARIANTS = (process.env.ONLY ? process.env.ONLY.split(",") : ALL).filter(
  (v) => ALL.includes(v.trim()),
);

// Préfixe de ligne ~80 B, représentatif d'un log Nodefony formaté.
const PREFIX =
  "16:32:01.247 INFO  HTTP-KERNEL : GET /nodefony/test 200 1.2ms wid=";

// ─────────────────────────────────────────────────────────────────────────────
// BRANCHE WORKER : ouvre le sink, attend "go", écrit LINES lignes, mesure dt.
// ─────────────────────────────────────────────────────────────────────────────
if (process.argv[2] === "worker") {
  const variant = process.env.VARIANT;
  const wid = Number(process.env.WID);
  const head = PREFIX + wid + " n=";
  let dropped = 0;

  // — Setup du sink (AVANT "ready" → l'open n'entre pas dans le chrono) —
  let fd = -1;
  if (variant.startsWith("file-shared")) fd = openSync(SHARED, "a");
  else if (variant.startsWith("file-perworker"))
    fd = openSync(perworkerPath(wid), "a");
  // stdout-shared → écrit sur fd 1 (hérité, partagé). null → rien.

  const finishSync = (dt) => {
    if (fd >= 0) closeSync(fd);
    process.send({ dt, dropped });
  };

  // Mode SYNC (null / stdout-shared / *-sync[-batch]) : boucle bloquante, writeSync inline.
  const runSync = () => {
    const t = performance.now();
    if (variant === "null") {
      // Plafond : on construit la ligne (coût format réel) mais on n'écrit pas.
      let sink = 0;
      for (let i = 0; i < LINES; i++) sink += (head + i + "\n").length;
      if (sink < 0) console.log(sink); // anti-DCE
    } else if (variant === "stdout-shared") {
      for (let i = 0; i < LINES; i++) writeSync(1, head + i + "\n");
    } else if (variant.endsWith("-batch")) {
      // Coalescé : accumule jusqu'à BATCH octets → 1 writeSync de gros chunk
      // (≈ nb de syscalls divisé par ~600). Isole « granularité syscall » de « contention ».
      let parts = [];
      let bytes = 0;
      for (let i = 0; i < LINES; i++) {
        const s = head + i + "\n";
        parts.push(s);
        bytes += s.length;
        if (bytes >= BATCH) {
          writeSync(fd, parts.join(""));
          parts.length = 0;
          bytes = 0;
        }
      }
      if (parts.length) writeSync(fd, parts.join(""));
    } else {
      for (let i = 0; i < LINES; i++) writeSync(fd, head + i + "\n");
    }
    finishSync(performance.now() - t);
  };

  // Mode ASYNC (FileSink-like) : buffer borné + 1 write en vol + drain ; backpressure
  // applicative (céder l'event loop pour laisser le threadpool drainer) → 0 OOM/drop.
  // dt = jusqu'au DRAIN COMPLET (toutes lignes réellement sur disque), pas l'enfilage.
  const runAsync = () => {
    const MAX = 4 * 1024 * 1024;
    const SOFT = MAX >> 1; // seuil de cession
    let pending = [];
    let pendingBytes = 0;
    let writing = false;
    let produced = 0;
    const t = performance.now();
    const drain = () => {
      if (writing || pending.length === 0) return;
      writing = true;
      const chunk = pending.join("");
      pending = [];
      pendingBytes = 0;
      fsWrite(fd, chunk, (err) => {
        writing = false;
        if (!err) drain();
      });
    };
    const pump = () => {
      while (produced < LINES && pendingBytes < SOFT) {
        const s = head + produced++ + "\n";
        if (pendingBytes >= MAX) {
          dropped++;
        } else {
          pending.push(s);
          pendingBytes += s.length;
          if (!writing) drain();
        }
      }
      if (produced < LINES) {
        setImmediate(pump); // cède → le threadpool écrit pendant ce temps
      } else {
        const wait = () => {
          if (!writing && pending.length === 0)
            finishSync(performance.now() - t);
          else setImmediate(wait);
        };
        wait();
      }
    };
    pump();
  };

  process.on("message", (m) => {
    if (m !== "go") return;
    if (variant === "file-perworker-async") runAsync();
    else runSync();
  });
  process.send("ready");
} else {
  // ───────────────────────────────────────────────────────────────────────────
  // BRANCHE MASTER : orchestre WORKERS process avec barrière, R runs/variante.
  // ───────────────────────────────────────────────────────────────────────────
  const cleanupFiles = () => {
    for (const p of [
      SHARED,
      STDOUT_FILE,
      ...Array.from({ length: WORKERS }, (_, i) => perworkerPath(i)),
    ]) {
      try {
        unlinkSync(p);
      } catch {
        /* absent */
      }
    }
  };

  // ── CONTRÔLE D'INTÉGRITÉ — sans lui, un débit ne prouve RIEN ────────────────
  // Une variante qui n'écrit pas est infiniment rapide. Vécu sur un banc jetable :
  // un fd mal hérité rendait « 174 ms » en ayant posé ZÉRO octet, et le chiffre
  // avait l'air parfaitement normal. On compare donc ce qui est SUR LE DISQUE à ce
  // qui aurait dû y être ; un écart invalide le run au lieu de le publier.

  /** Octets qu'un worker DOIT écrire : Σ des longueurs de ses lignes réelles. */
  const expectedBytesFor = (wid) => {
    const base = (PREFIX + wid + " n=").length + 1; // + "\n"
    let total = 0;
    for (let i = 0; i < LINES; i++) total += base + String(i).length;
    return total;
  };

  const sizeOf = (p) => {
    try {
      return statSync(p).size;
    } catch {
      return 0;
    }
  };

  /** Octets réellement écrits vs attendus. `null` = variante sans écriture (plafond CPU). */
  const integrity = (variant) => {
    if (variant === "null") return { written: 0, expected: 0 };
    const expected = Array.from({ length: WORKERS }, (_, w) =>
      expectedBytesFor(w),
    ).reduce((a, b) => a + b, 0);
    let written = 0;
    if (variant === "stdout-shared") written = sizeOf(STDOUT_FILE);
    else if (variant.startsWith("file-shared")) written = sizeOf(SHARED);
    else for (let w = 0; w < WORKERS; w++) written += sizeOf(perworkerPath(w));
    return { written, expected };
  };

  /** 1 run : spawn N workers, barrière ready→go, attend done, renvoie wall ms + drops. */
  const runOnce = (variant) =>
    new Promise((resolve, reject) => {
      // stdout-shared : fd fichier partagé hérité par TOUS les workers (offset commun).
      let sharedFd = -1;
      if (variant === "stdout-shared") sharedFd = openSync(STDOUT_FILE, "a");
      const stdio =
        variant === "stdout-shared"
          ? ["ignore", sharedFd, "inherit", "ipc"]
          : ["ignore", "ignore", "inherit", "ipc"];

      const kids = [];
      let ready = 0;
      let done = 0;
      let goAt = 0;
      let totalDropped = 0;
      const finish = () => {
        const wall = performance.now() - goAt;
        for (const k of kids) k.kill();
        if (sharedFd >= 0) closeSync(sharedFd);
        const { written, expected } = integrity(variant);
        resolve({ wall, dropped: totalDropped, written, expected });
      };
      for (let wid = 0; wid < WORKERS; wid++) {
        const child = spawn(process.execPath, [SELF, "worker"], {
          stdio,
          env: {
            ...process.env,
            VARIANT: variant,
            WID: String(wid),
            LINES: String(LINES),
          },
        });
        child.on("error", reject);
        child.on("message", (m) => {
          if (m === "ready") {
            if (++ready === WORKERS) {
              goAt = performance.now();
              for (const k of kids) k.send("go");
            }
          } else {
            totalDropped += m.dropped ?? 0;
            if (++done === WORKERS) finish();
          }
        });
        kids.push(child);
      }
    });

  const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  const main = async () => {
    const totalLines = WORKERS * LINES;
    console.log(
      `\n  LOG SINK CONTENTION — microbench LB.W (W2)\n` +
        `  workers=${WORKERS}  lines/worker=${LINES}  total=${(totalLines / 1e6).toFixed(2)}M lignes/run` +
        `  runs=${RUNS} (+${WARMUP} warmup)\n  tmp=${DIR}\n`,
    );
    const results = {};
    for (const variant of VARIANTS) {
      process.stdout.write(`  ▶ ${variant.padEnd(22)} `);
      const walls = [];
      let drops = 0;
      let shortfall = null; // 1ᵉʳ run dont le volume écrit ne colle pas
      for (let r = 0; r < WARMUP + RUNS; r++) {
        cleanupFiles();
        const { wall, dropped, written, expected } = await runOnce(variant);
        // Les drops sont attendus (backpressure) : on tolère un déficit à hauteur
        // des lignes explicitement droppées, jamais au-delà.
        if (expected > 0 && written < expected * 0.999 && dropped === 0) {
          shortfall ??= { written, expected };
        }
        if (r >= WARMUP) {
          walls.push(wall);
          drops += dropped;
          process.stdout.write("·");
        } else {
          process.stdout.write("∘");
        }
      }
      const med = median(walls);
      results[variant] = {
        med,
        min: Math.min(...walls),
        max: Math.max(...walls),
        rate: totalLines / (med / 1000),
        drops,
        shortfall,
      };
      console.log(
        ` ${med.toFixed(0)}ms` +
          (shortfall
            ? `  ✖ INVALIDE : ${shortfall.written} o écrits / ${shortfall.expected} attendus`
            : ""),
      );
    }
    cleanupFiles();

    // — Tableau —
    console.log(`\n  ── RÉSULTAT (médiane sur ${RUNS} runs) ──`);
    console.log(
      `  ${"variante".padEnd(22)} ${"médiane".padStart(9)} ${"M lignes/s".padStart(11)} ${"variance".padStart(9)}  drops`,
    );
    for (const v of VARIANTS) {
      const r = results[v];
      const varPct = (((r.max - r.min) / r.med) * 100).toFixed(0);
      console.log(
        `  ${v.padEnd(22)} ${(r.med.toFixed(0) + "ms").padStart(9)} ${(r.rate / 1e6).toFixed(2).padStart(11)} ${(varPct + "%").padStart(9)}  ${r.drops}` +
          (r.shortfall ? "  ✖ VOLUME INVALIDE" : ""),
      );
    }

    const invalid = VARIANTS.filter((v) => results[v].shortfall);
    if (invalid.length) {
      console.log(
        `\n  ✖ ${invalid.length} variante(s) n'ont PAS écrit ce qu'elles devaient : ${invalid.join(", ")}.`,
      );
      console.log(
        `    Leurs durées ne mesurent rien — ne PAS les comparer. (Une variante qui`,
      );
      console.log(`    n'écrit pas est infiniment rapide.)`);
      process.exit(1);
    }

    // — Comparaisons clés —
    // ⚠️ Un écart INFÉRIEUR à la variance n'est pas un écart. Les variantes
    // coalescées tombent à ~80 ms avec 20-30 % de variance : y lire un « ×1.03 »
    // serait du bruit promu en conclusion.
    const ratio = (a, b) => {
      if (!results[a] || !results[b]) return "—";
      const r = results[b].med / results[a].med;
      const noise =
        (results[a].max - results[a].min) / results[a].med +
        (results[b].max - results[b].min) / results[b].med;
      return Math.abs(r - 1) < noise / 2
        ? `${r.toFixed(2)} (DANS LE BRUIT — aucun écart mesurable)`
        : r.toFixed(2);
    };
    console.log(`\n  ── COMPARAISONS ──`);
    if (results["file-shared-sync"] && results["file-perworker-sync"])
      console.log(
        `  W2 contention inode (1 write/ligne)  : perworker ×${ratio("file-perworker-sync", "file-shared-sync")} plus rapide que shared`,
      );
    if (
      results["file-shared-sync-batch"] &&
      results["file-perworker-sync-batch"]
    )
      console.log(
        `  W2 contention inode (coalescé batch) : perworker ×${ratio("file-perworker-sync-batch", "file-shared-sync-batch")} plus rapide que shared`,
      );
    if (results["file-perworker-sync"] && results["file-perworker-sync-batch"])
      console.log(
        `  COALESCENCE (syscalls) : sync-batch ×${ratio("file-perworker-sync-batch", "file-perworker-sync")} vs sync 1/ligne`,
      );
    if (results["file-perworker-sync-batch"] && results["file-perworker-async"])
      console.log(
        `  async vs sync-batch    : sync-batch ×${ratio("file-perworker-sync-batch", "file-perworker-async")} vs async (>1 ⇒ sync-batch gagne)`,
      );
    if (results["stdout-shared"] && results["file-perworker-sync-batch"])
      console.log(
        `  vs historique stdout   : perworker-sync-batch ×${ratio("file-perworker-sync-batch", "stdout-shared")} vs stdout-shared`,
      );
    console.log("");
    process.exit(0);
  };

  main().catch((e) => {
    console.error("\n  FATAL:", e?.stack ?? e);
    process.exit(1);
  });
}
