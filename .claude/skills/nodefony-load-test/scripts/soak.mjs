/**
 * soak.mjs — TENUE DANS LA DURÉE d'un process Nodefony sous trafic continu.
 *
 * Ce qu'un banc de 10 secondes ne peut PAS voir : une fuite lente. 30 MB perdus
 * par heure ne se distinguent pas du bruit sur trois runs de 10 s ; sur un pod qui
 * vit trois jours, ils tuent le process. Ce banc mesure donc une PENTE, pas un
 * delta début/fin — un delta est une différence de deux mesures bruitées, une
 * pente sur N points dit si ça monte VRAIMENT, et son R² dit si la droite décrit
 * quelque chose ou si on lit dans le marc de café.
 *
 * ── TROIS PIÈGES, tous déjà payés ailleurs dans ce dépôt ────────────────────
 *
 * 1. `--expose-gc` est OBLIGATOIRE. La sonde `/nodefony/test/memory` force un GC
 *    avant de lire le heap — mais seulement si le runtime l'expose. Sans ça on
 *    mesure le déchet EN ATTENTE de collecte et toute charge soutenue ressemble à
 *    une fuite (vécu sur le gate WS : ~180 MB de garbage pris pour une fuite).
 *
 * 2. Le DÉBIT est un second signal, gratuit. Une fuite se voit aussi à la
 *    dégradation : GC de plus en plus long ⇒ RPS qui s'effrite fenêtre après
 *    fenêtre. On garde donc le RPS de chaque fenêtre, pas seulement la mémoire.
 *
 * 3. Une pente POSITIVE ne prouve pas une fuite sur un run court : un tas monte
 *    naturellement jusqu'à son régime (caches, pools, buffers amortis). C'est
 *    pourquoi on ÉCARTE les premières fenêtres (`--skip`) — le régime établi est
 *    ce qui nous intéresse, pas la montée initiale.
 *
 * Ce banc ne remplace pas une observation de plusieurs jours en production. Il
 * élimine les fuites GROSSIÈRES, celles qui se voient en dizaines de minutes.
 *
 * Usage :
 *   node .claude/skills/nodefony-load-test/scripts/soak.mjs
 *   node ... soak.mjs --minutes 30 --conn 64 --skip 2
 *   node ... soak.mjs --url http://127.0.0.1:5151/nodefony/kernel/bench
 */
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { openSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};

const MINUTES = Number(arg("minutes", "10"));
const WINDOW = Number(arg("window", "30")); // secondes par fenêtre wrk
const CONN = Number(arg("conn", "64"));
const THREADS = Number(arg("threads", "4"));
const SKIP = Number(arg("skip", "2")); // fenêtres écartées (montée en régime)
const URL = arg("url", "http://127.0.0.1:5151/nodefony/test/als-test/state");
const PROBE = arg("probe", "http://127.0.0.1:5151/nodefony/test/memory");
const OUT = arg("out", path.join(ROOT, "tmp", "soak.json"));

const WINDOWS = Math.max(1, Math.round((MINUTES * 60) / WINDOW));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MB = (b) => b / 1024 / 1024;

/** Attend qu'un port accepte une connexion, ou rend false au bout de `timeoutMs`. */
async function waitPort(port, timeoutMs) {
  const t0 = Date.now();
  for (;;) {
    const ok = await new Promise((res) => {
      const s = net.connect(port, "127.0.0.1");
      s.on("connect", () => {
        s.destroy();
        res(true);
      });
      s.on("error", () => {
        s.destroy();
        res(false);
      });
    });
    if (ok) return true;
    if (Date.now() - t0 > timeoutMs) return false;
    await sleep(400);
  }
}

/** Régression linéaire y = a·x + b, plus le R² qui dit si la droite vaut quelque chose. */
function slope(points) {
  const n = points.length;
  if (n < 3) return { perHour: 0, r2: 0, n };
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const p of points) {
    sxy += (p.x - mx) * (p.y - my);
    sxx += (p.x - mx) ** 2;
    syy += (p.y - my) ** 2;
  }
  const a = sxx === 0 ? 0 : sxy / sxx;
  const r2 = sxx === 0 || syy === 0 ? 0 : (sxy * sxy) / (sxx * syy);
  return { perHour: a * 3600, r2, n }; // x est en secondes → pente par heure
}

// ── 1. décor propre ────────────────────────────────────────────────────────
spawnSync("node", [path.join(ROOT, "src/nodefony/bin/nodefony"), "stop"], {
  cwd: ROOT,
  stdio: "ignore",
});
await sleep(500);

// ── 2. serveur production AVEC --expose-gc (cf piège 1) ────────────────────
const logFd = openSync("/tmp/nf-soak.log", "w");
const srv = spawn(
  "node",
  ["--expose-gc", "src/nodefony/bin/nodefony", "production"],
  {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: "production",
      NF_LOG_DRIVER: "null",
      NF_BENCH_ROUTE: "1",
      NF_WITH_DEV_MODULES: "1",
      NF_WITH_DEV_MODULES_TTL_MIN: String(Math.ceil(MINUTES) + 30),
    },
    stdio: ["ignore", logFd, logFd],
    detached: true,
  },
);
srv.unref();

const stop = () => {
  try {
    process.kill(srv.pid, "SIGINT");
  } catch {
    /* déjà mort */
  }
};
process.on("exit", stop);
process.on("SIGINT", () => {
  stop();
  process.exit(130);
});

if (!(await waitPort(5151, 40_000))) {
  console.error("BOOT FAIL — voir /tmp/nf-soak.log");
  stop();
  process.exit(1);
}

// ── 3. la cible répond-elle VRAIMENT ? (une erreur répond plus vite) ───────
const head = await fetch(URL).catch(() => null);
if (!head || head.status !== 200) {
  console.error(
    `❌ cible ${URL} → ${head ? head.status : "injoignable"} (attendu 200) — aucune mesure ne serait valide.`,
  );
  stop();
  process.exit(1);
}
const probe0 = await fetch(PROBE).catch(() => null);
if (!probe0 || probe0.status !== 200) {
  console.error(`❌ sonde mémoire ${PROBE} injoignable — rien à mesurer.`);
  stop();
  process.exit(1);
}

// Le piège 1 de l'en-tête, CONSTATÉ au lieu d'être espéré. Ce banc lance son
// serveur avec `--expose-gc`, mais un drapeau posé n'est pas un drapeau ARRIVÉ :
// s'il ne traverse pas le lancement, la sonde devient un no-op silencieux et
// tout ce qui suit mesure le déchet en attente de collecte. Une pente montante
// serait alors garantie — et prise pour une fuite. Mieux vaut ne RIEN mesurer
// que publier ce chiffre-là.
const etatGc = await probe0
  .clone()
  .json()
  .catch(() => ({}));
if (etatGc.gcForced !== true) {
  console.error(
    `❌ le serveur sous test n'expose PAS \`gc\` — la sonde ne collecte rien\n` +
      `   avant de lire le tas, et ce banc mesurerait du déchet transitoire.\n` +
      `   (sonde ${PROBE} → gcForced: ${JSON.stringify(etatGc.gcForced)})`,
  );
  stop();
  process.exit(1);
}

console.log(
  `soak ${MINUTES} min · ${WINDOWS} fenêtres de ${WINDOW}s · c${CONN} · ${URL}`,
);
console.log(
  `  (${SKIP} première(s) fenêtre(s) écartée(s) : montée en régime)\n`,
);

// ── 4. charge continue + échantillonnage ──────────────────────────────────
const samples = [];
const t0 = Date.now();
for (let w = 1; w <= WINDOWS; w++) {
  const out = spawnSync(
    "wrk",
    [`-t${THREADS}`, `-c${CONN}`, `-d${WINDOW}s`, "--latency", URL],
    { encoding: "utf8" },
  );
  const txt = out.stdout || "";
  const rps = Number(/Requests\/sec:\s+([\d.]+)/.exec(txt)?.[1] ?? 0);
  const p99raw = /^\s+99%\s+(\S+)/m.exec(txt)?.[1] ?? "0";
  const p99 = p99raw.endsWith("us")
    ? parseFloat(p99raw) / 1000
    : p99raw.endsWith("ms")
      ? parseFloat(p99raw)
      : parseFloat(p99raw) * 1000;
  const bad = /Non-2xx or 3xx responses|Socket errors/.test(txt);

  const mem = await fetch(PROBE)
    .then((r) => r.json())
    .catch(() => null);
  if (!mem) {
    console.error(`  fenêtre ${w}: sonde mémoire muette — arrêt.`);
    break;
  }
  const s = {
    window: w,
    atSec: Math.round((Date.now() - t0) / 1000),
    rps,
    p99Ms: p99,
    rssMb: +MB(mem.rss).toFixed(1),
    heapUsedMb: +MB(mem.heapUsed).toFixed(1),
    errors: bad,
  };
  samples.push(s);
  console.log(
    `  fenêtre ${String(w).padStart(2)}/${WINDOWS} · ${String(Math.round(rps)).padStart(6)} rps · p99 ${s.p99Ms.toFixed(2)}ms · heap ${s.heapUsedMb} MB · rss ${s.rssMb} MB${bad ? "  ⚠ erreurs" : ""}`,
  );
}

stop();

// ── 5. verdict : une PENTE, pas un delta ──────────────────────────────────
const kept = samples.slice(SKIP);
if (kept.length < 3) {
  console.error("\n✖ moins de 3 fenêtres exploitables — aucun verdict.");
  process.exit(1);
}
const heap = slope(kept.map((s) => ({ x: s.atSec, y: s.heapUsedMb })));
const rss = slope(kept.map((s) => ({ x: s.atSec, y: s.rssMb })));
const rpsFirst = kept[0].rps;
const rpsLast = kept[kept.length - 1].rps;
const drift = ((rpsLast - rpsFirst) / rpsFirst) * 100;
// Les erreurs ne comptent que dans les fenêtres RETENUES : celles de la montée en
// régime sont écartées du verdict, et douter d'un run à cause de données qu'on a
// soi-même jetées, c'est inventer un défaut — la sonde doit couvrir exactement ce
// qu'elle juge. Les erreurs écartées restent DITES, pour qu'un décor instable ne
// disparaisse pas non plus en silence.
const anyErr = kept.some((s) => s.errors);
const errSkipped = samples.slice(0, SKIP).some((s) => s.errors);

console.log(
  `\n══ SOAK — ${kept.length} fenêtres retenues sur ${samples.length} ══`,
);
console.log(
  `  heap   : ${kept[0].heapUsedMb} → ${kept[kept.length - 1].heapUsedMb} MB · pente ${heap.perHour >= 0 ? "+" : ""}${heap.perHour.toFixed(1)} MB/h (R² ${heap.r2.toFixed(2)})`,
);
// ── PLATEAU ou RAMPE ? Le test qui empêche de crier au loup ────────────────
// Une régression linéaire sur une courbe qui PLAFONNE rend toujours une pente
// positive : elle moyenne la montée initiale avec le palier. Un tas ou un RSS qui
// grimpe puis se stabilise est le comportement NORMAL (arènes de l'allocateur que
// le process ne rend pas à l'OS, caches qui se remplissent) — le confondre avec
// une fuite envoie chercher un défaut qui n'existe pas.
// Comparer la pente de la SECONDE moitié à la pente globale tranche en une ligne :
// si elle s'effondre, la courbe plafonne. Une vraie fuite, elle, garde la même
// pente jusqu'au bout — c'est ce qui la définit.
const half = Math.floor(kept.length / 2);
const rssLate = slope(
  kept.slice(half).map((s) => ({ x: s.atSec, y: s.rssMb })),
);
const plateau = rss.perHour > 5 && rssLate.perHour < rss.perHour / 3;
console.log(
  `  rss    : ${kept[0].rssMb} → ${kept[kept.length - 1].rssMb} MB · pente ${rss.perHour >= 0 ? "+" : ""}${rss.perHour.toFixed(1)} MB/h (R² ${rss.r2.toFixed(2)})` +
    (plateau
      ? `\n           ↳ PLATEAU : ${rssLate.perHour >= 0 ? "+" : ""}${rssLate.perHour.toFixed(1)} MB/h sur la SECONDE moitié — la courbe s'aplatit, la pente globale moyenne la montée initiale`
      : ""),
);
console.log(
  `  débit  : ${Math.round(rpsFirst)} → ${Math.round(rpsLast)} rps (${drift >= 0 ? "+" : ""}${drift.toFixed(1)} %)`,
);

// ── Trois conditions pour OSER dire « fuite », et pas une de moins ─────────
//
// La pente seule est un piège : elle est exprimée par HEURE, donc une variation
// de 1 MB observée sur 100 secondes s'extrapole à +36 MB/h — un chiffre qui a
// l'air alarmant et ne repose sur rien. Ce banc a crié « FUITE PROBABLE » sur un
// heap passé de 46,2 à 47,3 MB, c'est-à-dire sur du bruit de GC. L'instrument
// mentait, pas le serveur.
//
//   (1) DURÉE — une droite ajustée sur moins de `MIN_MINUTES` d'observation ne
//       s'extrapole pas à l'heure. En dessous : verdict INDÉTERMINÉ, jamais
//       « propre » (l'absence de preuve n'est pas une preuve d'absence).
//   (2) AMPLITUDE — l'écart réellement OBSERVÉ doit dépasser le bruit du GC. Une
//       pente magnifique sur 1 MB reste 1 MB.
//   (3) RÉGULARITÉ — R² élevé, sinon la droite ne décrit pas les points.
const MIN_MINUTES = 10; // sous ce seuil, une pente/heure n'a pas de sens
const MIN_AMPLITUDE_MB = 8; // sous ce seuil, c'est le bruit du GC
const observedMin = (kept[kept.length - 1].atSec - kept[0].atSec) / 60;
const amplitude = Math.abs(
  kept[kept.length - 1].heapUsedMb - kept[0].heapUsedMb,
);
const tooShort = observedMin < MIN_MINUTES;
const leaking =
  !tooShort &&
  heap.perHour > 20 &&
  heap.r2 > 0.7 &&
  amplitude >= MIN_AMPLITUDE_MB;
const degrading = drift < -10;
if (anyErr) {
  console.log(
    "\n  ⚠ des fenêtres RETENUES ont vu des erreurs — verdict à relativiser.",
  );
} else if (errSkipped) {
  console.log(
    `\n  ℹ erreurs vues pendant la montée en régime (${SKIP} fenêtre(s) écartée(s)) —` +
      ` hors du verdict. Décor à surveiller si cela se répète.`,
  );
}
if (tooShort) {
  console.log(
    `\n  ⊘ INDÉTERMINÉ — ${observedMin.toFixed(1)} min d'observation retenue (< ${MIN_MINUTES} min).` +
      `\n    Une pente par HEURE ajustée sur si peu extrapole du bruit : ici ${heap.perHour >= 0 ? "+" : ""}${heap.perHour.toFixed(1)} MB/h` +
      ` pour ${amplitude.toFixed(1)} MB réellement observés. Relancer avec --minutes ${MIN_MINUTES + 5}.`,
  );
} else if (leaking) {
  console.log(
    `\n  ✖ FUITE PROBABLE — heap +${amplitude.toFixed(1)} MB en ${observedMin.toFixed(0)} min,` +
      ` régulier (R² ${heap.r2.toFixed(2)}) ⇒ ${heap.perHour.toFixed(1)} MB/h.`,
  );
} else if (amplitude < MIN_AMPLITUDE_MB) {
  console.log(
    `\n  ✅ pas de fuite — ${amplitude.toFixed(1)} MB d'écart sur ${observedMin.toFixed(0)} min,` +
      ` sous le bruit du GC (${MIN_AMPLITUDE_MB} MB). La pente affichée n'est pas exploitable.`,
  );
} else if (heap.r2 <= 0.7) {
  console.log(
    `\n  ✅ pas de fuite — le heap OSCILLE sans tendance (R² ${heap.r2.toFixed(2)} : aucune droite ne le décrit).`,
  );
} else {
  console.log(
    `\n  ✅ pas de fuite — pente ${heap.perHour.toFixed(1)} MB/h sous le seuil de 20 MB/h.`,
  );
}
if (degrading) {
  console.log(
    `  ✖ DÉBIT DÉGRADÉ de ${drift.toFixed(1)} % — signe d'un GC qui travaille de plus en plus.`,
  );
}

// ── Le RSS a droit au MÊME examen que le tas ──────────────────────────────
//
// 🔴 Ce banc mesurait deux grandeurs et n'en jugeait qu'une. Vécu : un run de
// 30 minutes a rendu « ✅ pas de fuite » sur un tas parfaitement plat, pendant
// que son RSS montait de 235 à 251 Mo avec un R² de 0,92 et SANS plafonner —
// c'est-à-dire en satisfaisant les trois conditions que ce même fichier exige
// pour oser dire « fuite ». Le verdict gaspillait ce qu'il avait déjà mesuré.
//
// La distinction n'est pas académique : c'est le RSS qu'un orchestrateur
// surveille, et c'est lui qui fait tuer un pod. Un tas stable dans un RSS qui
// grimpe désigne une autre famille de causes — mémoire native, tampons hors
// tas, fragmentation de l'allocateur — que le tas ne montrera jamais.
//
// Ce n'est PAS un échec : un RSS peut plafonner plus tard, et l'annoncer en
// rouge fabriquerait le faux positif que ce fichier combat par ailleurs. C'est
// un fait ÉNONCÉ, avec sa projection, pour qu'il ne passe plus inaperçu.
const rssAmplitude = Math.abs(kept[kept.length - 1].rssMb - kept[0].rssMb);
const rssSuspect =
  !tooShort &&
  !plateau &&
  rss.perHour > 20 &&
  rss.r2 > 0.7 &&
  rssAmplitude >= MIN_AMPLITUDE_MB;
if (rssSuspect) {
  console.log(
    `\n  ⚠ RSS EN HAUSSE SOUTENUE — +${rssAmplitude.toFixed(1)} MB en ${observedMin.toFixed(0)} min,` +
      ` régulier (R² ${rss.r2.toFixed(2)}) et SANS plateau ⇒ ${rss.perHour.toFixed(1)} MB/h.` +
      `\n    Projection : ~${(rss.perHour * 24).toFixed(0)} MB/jour, ~${((rss.perHour * 72) / 1024).toFixed(1)} Go sur 3 jours.` +
      `\n    Le TAS est ${leaking ? "lui aussi en hausse" : "stable"} : chercher hors du tas JavaScript` +
      ` (tampons natifs, sockets, fragmentation de l'allocateur), pas une rétention d'objets.` +
      `\n    Relancer plus long (--minutes 90) tranche entre montée vers un palier et hausse sans fin.`,
  );
}
console.log(
  `\n  ⚠ ${MINUTES} min ne prouvent pas 3 jours : ce banc élimine les fuites grossières, pas les lentes.`,
);

writeFileSync(
  OUT,
  JSON.stringify(
    {
      url: URL,
      minutes: MINUTES,
      windowSec: WINDOW,
      conn: CONN,
      skipped: SKIP,
      node: process.version,
      samples,
      heapSlopeMbPerHour: +heap.perHour.toFixed(2),
      heapR2: +heap.r2.toFixed(3),
      rssSlopeMbPerHour: +rss.perHour.toFixed(2),
      rssR2: +rss.r2.toFixed(3),
      rssSlopeLateMbPerHour: +rssLate.perHour.toFixed(2),
      rssPlateau: plateau,
      rpsDriftPct: +drift.toFixed(1),
      observedMinutes: +observedMin.toFixed(1),
      amplitudeMb: +amplitude.toFixed(1),
      verdict: tooShort ? "indeterminate" : leaking ? "leak" : "clean",
    },
    null,
    2,
  ),
);
console.log(`  données : ${OUT}`);
