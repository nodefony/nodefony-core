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
import { mkdirSync, openSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
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

// ── 0. le GÉNÉRATEUR DE CHARGE existe-t-il ? ───────────────────────────────
//
// Sans cette garde, l'absence de `wrk` est SILENCIEUSE : `spawnSync` rend une
// erreur ENOENT que rien ne lit, `out.stdout` vaut la chaîne vide, le débit se
// parse à 0 — et le banc déroule ses fenêtres jusqu'au bout sur un serveur qui
// ne reçoit AUCUNE requête. Le tas ne bouge pas, le RSS non plus, et il conclut
// « ✅ pas de fuite ». C'est le faux VERT le plus cher qui soit : il ferme une
// question au lieu de la poser, et rien dans la sortie ne trahit que la charge
// n'a jamais eu lieu.
//
// La capacité se CONSTATE (axiome 4 du dépôt) : on ne déduit pas la présence de
// `wrk` de la plateforme, on tente de l'exécuter. `wrk --version` sort en code 1
// avec son usage — c'est ENOENT qu'il faut lire, jamais le code de sortie.
// Le dossier de sortie se prépare MAINTENANT, pas à la dernière ligne. Dans un
// dépôt fraîchement cloné, `tmp/` est ignoré par git et n'existe donc pas : le
// banc chargeait trente minutes durant avant d'échouer sur l'écriture, et le
// résultat de la mesure partait avec. Ce qu'un run produit doit avoir une place
// où atterrir AVANT qu'on le produise.
mkdirSync(path.dirname(OUT), { recursive: true });

const wrkProbe = spawnSync("wrk", ["--version"], { encoding: "utf8" });
if (wrkProbe.error?.code === "ENOENT") {
  console.error(
    `❌ \`wrk\` introuvable — ce banc n'a aucun moyen de charger le serveur.\n` +
      `   Sans lui il mesurerait un process au repos et conclurait « pas de fuite ».\n` +
      `   linux : sudo apt-get install -y wrk · macOS : brew install wrk`,
  );
  process.exit(1);
}

// ── 0 bis. la machine est-elle DISPONIBLE ? ────────────────────────────────
//
// Ce banc refuse de mesurer sans ramasse-miettes et sans charge — mais il
// acceptait sans broncher de partir sur une machine déjà occupée. Vécu deux
// fois le même jour : un run tué par mes propres compilations (p99 × 12), un
// autre faussé par une console d'administration ouverte dans un navigateur, qui
// tapait sur le serveur MESURÉ — le tas s'est mis à monter, le débit à chuter,
// et le verdict a failli passer pour une fuite du framework.
//
// Une machine occupée ne rend pas une mesure « un peu moins bonne » : elle rend
// une AUTRE mesure. Mieux vaut refuser au départ que le découvrir 90 minutes
// plus tard.
const COEURS = os.availableParallelism?.() ?? os.cpus().length;
const SEUIL_CHARGE = COEURS * 0.5;

// ── Le décor VIRTUALISÉ, CONSTATÉ (axiome 4 : une capacité ne se déduit pas) ──
//
// `loadavg` ne voit pas une machine virtuelle : un hyperviseur qui réserve 8 des
// 12 cœurs laisse une charge basse, et le banc part sereinement sur une machine
// dont il ignore qu'elle est partagée. Le dépôt a déjà payé cette cécité ailleurs
// — facteur 3,7 sur le seul chemin virtualisé de Docker Desktop, sur macOS.
//
// ⚠️ Ce champ ne DÉSIGNE aucun coupable, et ne doit pas servir à en désigner un :
// deux runs de ce banc pris sur cette machine, hyperviseur allumé dans les DEUX
// cas, ont rendu 7 048 et 10 971 rps. La virtualisation n'expliquait donc pas cet
// écart-là. Ce qu'on grave ici est un ÉLÉMENT DE DÉCOR, pas une cause : il permet
// de savoir si deux runs sont comparables, jamais de conclure pourquoi ils
// diffèrent.
const VCPU_VIRTUALISES = (() => {
  const r = spawnSync("docker", ["info", "--format", "{{.NCPU}}"], {
    encoding: "utf8",
    timeout: 4000,
  });
  const n = Number((r.stdout ?? "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
})();
if (VCPU_VIRTUALISES) {
  console.log(
    `⚠ hyperviseur ACTIF — ${VCPU_VIRTUALISES} vCPU réservés sur ${COEURS} cœurs.\n` +
      `  La charge moyenne ne le voit pas, le débit si : les ABSOLUS de ce run ne se\n` +
      `  comparent qu'à d'autres runs pris dans le même décor. Pour un chiffre\n` +
      `  transposable, arrêter la machine virtuelle (Docker Desktop, Colima, VM).`,
  );
}

// `--attendre-charge <s>` : ATTENDRE la retombée au lieu de refuser tout de
// suite. C'est le conseil que ce message donne déjà à un humain — sur un
// exécuteur d'intégration, personne n'est là pour le suivre.
//
// Le cas est structurel, pas accidentel : le banc suit un `npm ci` et un build
// qui saturent la machine, et `loadavg[0]` est une moyenne sur UNE MINUTE — elle
// décrit donc le passé récent, pas l'instant. Mesuré à l'échec : 3,54 sur 4
// cœurs (ubuntu) et 21,72 sur 3 (macOS), quelques secondes après le build. Sans
// attente, ce workflow ne pouvait pas démarrer une seule fois, et il était rouge
// en permanence — donc plus lu, alors qu'il porte la traque d'une fuite RSS.
//
// L'attente ne DÉSARME rien : passé le délai, le refus tombe comme avant, avec
// la charge finale. C'est `--force-charge` qui désarme, et lui seul.
const ATTENDRE_CHARGE = (() => {
  const i = process.argv.indexOf("--attendre-charge");
  const v = i > 0 ? Number(process.argv[i + 1]) : 0;
  return Number.isFinite(v) && v > 0 ? v : 0;
})();

let chargeInitiale = os.loadavg()[0];
if (chargeInitiale > SEUIL_CHARGE && ATTENDRE_CHARGE > 0) {
  const limite = Date.now() + ATTENDRE_CHARGE * 1000;
  console.log(
    `⏳ charge ${chargeInitiale.toFixed(2)} > ${SEUIL_CHARGE.toFixed(2)} — attente de la retombée (max ${ATTENDRE_CHARGE}s)…`,
  );
  while (chargeInitiale > SEUIL_CHARGE && Date.now() < limite) {
    await sleep(5000);
    chargeInitiale = os.loadavg()[0];
  }
  console.log(
    `   charge après attente : ${chargeInitiale.toFixed(2)} sur ${COEURS} cœurs`,
  );
}

if (chargeInitiale > SEUIL_CHARGE && !process.argv.includes("--force-charge")) {
  console.error(
    `❌ machine OCCUPÉE — charge moyenne ${chargeInitiale.toFixed(2)} sur ${COEURS} cœurs.\n` +
      `   Au-dessus de la moitié des cœurs, ce qu'on mesure est le voisin, pas le serveur.\n` +
      `   Fermer ce qui tourne (compilations, conteneurs, navigateur ouvert sur l'application)\n` +
      `   et attendre la retombée (\`--attendre-charge <secondes>\`). Délibéré ? --force-charge`,
  );
  process.exit(1);
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
//
// 🔴 RIEN DANS CETTE BOUCLE N'EST SANS BORNE DE TEMPS. Vécu, et cher : un run
// de 90 min s'est arrêté à la 37ᵉ fenêtre, puis le script est resté DEUX HEURES
// pendu avant de rendre son verdict (dernière mesure à atSec=1090, fichier écrit
// 2 h 19 après le lancement). Ni `spawnSync` ni `fetch` n'ont de délai par
// défaut : un générateur coincé sur des sockets en attente, ou un serveur dont
// la boucle d'événements est figée, immobilisent le banc — et le poste avec lui.
// Un banc qui n'avance plus doit ABANDONNER en le disant, jamais attendre.
const WRK_TIMEOUT_MS = (WINDOW + 30) * 1000; // la fenêtre, plus une marge franche
const SONDE_TIMEOUT_MS = 10_000;
const SONDE_ESSAIS = 3;

/**
 * Interroge la sonde mémoire, avec délai et réessais — et RETIENT l'erreur.
 *
 * L'ancienne version faisait `.catch(() => null)` : un hoquet unique tuait le
 * run (74 min perdues sur 90), et l'on ne savait même pas LEQUEL — serveur mort
 * (ECONNREFUSED), boucle figée (délai dépassé) ou réponse illisible se
 * présentaient tous comme le même `null` muet. Une sonde qui abandonne doit dire
 * de quoi elle est morte, sinon le diagnostic recommence à zéro le lendemain.
 */
async function sonder() {
  let derniere = null;
  for (let essai = 1; essai <= SONDE_ESSAIS; essai++) {
    try {
      const r = await fetch(PROBE, {
        signal: AbortSignal.timeout(SONDE_TIMEOUT_MS),
      });
      if (!r.ok) {
        derniere = `HTTP ${r.status}`;
        continue;
      }
      return { mem: await r.json(), erreur: null };
    } catch (e) {
      derniere =
        e?.name === "TimeoutError"
          ? `pas de réponse en ${SONDE_TIMEOUT_MS / 1000}s (boucle d'événements figée ?)`
          : (e?.cause?.code ?? e?.code ?? e?.name ?? String(e));
    }
    if (essai < SONDE_ESSAIS) await sleep(2000);
  }
  return { mem: null, erreur: derniere };
}

const samples = [];
const t0 = Date.now();
for (let w = 1; w <= WINDOWS; w++) {
  const out = spawnSync(
    "wrk",
    [`-t${THREADS}`, `-c${CONN}`, `-d${WINDOW}s`, "--latency", URL],
    {
      encoding: "utf8",
      timeout: WRK_TIMEOUT_MS,
      killSignal: "SIGKILL",
    },
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

  const { mem, erreur: erreurSonde } = await sonder();
  if (!mem) {
    console.error(
      `  fenêtre ${w}/${WINDOWS}: sonde mémoire muette après ${SONDE_ESSAIS} essais` +
        ` — ${erreurSonde}. Arrêt à ${Math.round((Date.now() - t0) / 60000)} min` +
        ` sur ${MINUTES} demandées.`,
    );
    break;
  }
  const s = {
    window: w,
    atSec: Math.round((Date.now() - t0) / 1000),
    rps,
    p99Ms: p99,
    rssMb: +MB(mem.rss).toFixed(1),
    heapUsedMb: +MB(mem.heapUsed).toFixed(1),
    // La sonde rendait DÉJÀ ces deux-là, et le banc les jetait. Ce sont
    // pourtant les seules grandeurs qui permettent de DÉCOMPOSER une hausse du
    // RSS : sans elles, on constate qu'il monte sans jamais pouvoir dire où.
    heapTotalMb: +MB(mem.heapTotal).toFixed(1),
    externalMb: +MB(mem.external).toFixed(1),
    // Les ressources que le runtime tient ouvertes. Une hausse du RSS à tas
    // plat pose d'abord cette question — sockets ou timers qui s'accumulent —
    // et un compte stable élimine la famille entière. `null` quand la sonde
    // servie ne rend pas encore le champ : on CONSTATE son absence au lieu de
    // la lire comme un zéro, qui signifierait « aucune ressource active ».
    handlesTotal:
      typeof mem.activeResourcesTotal === "number"
        ? mem.activeResourcesTotal
        : null,
    handlesByType: mem.activeResources ?? null,
    // La charge de la MACHINE et le nombre de connexions au SERVEUR, fenêtre
    // par fenêtre. Le banc ouvre un nombre CONSTANT de connexions : toute
    // connexion supplémentaire est un tiers qui tape sur le process mesuré, et
    // c'est exactement ce qui a fait monter le tas sur un run de 90 minutes.
    charge: +os.loadavg()[0].toFixed(2),
    sockets: mem.activeResources?.TCPSocketWrap ?? null,
    errors: bad,
  };
  samples.push(s);
  console.log(
    `  fenêtre ${String(w).padStart(2)}/${WINDOWS} · ${String(Math.round(rps)).padStart(6)} rps · p99 ${s.p99Ms.toFixed(2)}ms · heap ${s.heapUsedMb} MB · rss ${s.rssMb} MB · ext ${s.externalMb} MB${bad ? "  ⚠ erreurs" : ""}`,
  );
}

stop();

// ── 5. verdict : une PENTE, pas un delta ──────────────────────────────────
const kept = samples.slice(SKIP);
if (kept.length < 3) {
  console.error("\n✖ moins de 3 fenêtres exploitables — aucun verdict.");
  process.exit(1);
}

// ── La charge a-t-elle EU LIEU ? ──────────────────────────────────────────
//
// `wrk` peut être présent et n'avoir rien envoyé : cible qui refuse, ports
// épuisés, générateur tué par l'ordonnanceur. Un débit nul produit exactement
// la même courbe qu'un serveur sain — plate — et le verdict « pas de fuite »
// serait rendu sur un process au repos. Le banc EXIGE donc de constater son
// propre trafic avant de juger quoi que ce soit.
const rpsKept = kept.map((s) => s.rps).sort((a, b) => a - b);
const rpsMedian = rpsKept[Math.floor(rpsKept.length / 2)];
if (rpsMedian <= 0) {
  console.error(
    `\n✖ AUCUNE CHARGE — débit médian ${rpsMedian} rps sur ${kept.length} fenêtres retenues.\n` +
      `  Le serveur n'a rien reçu : tout verdict porterait sur un process au repos.\n` +
      `  Voir /tmp/nf-soak.log et vérifier que ${URL} répond sous wrk.`,
  );
  process.exit(1);
}

// Le TRAVAIL réellement accompli pendant les fenêtres retenues. C'est lui qui
// permet de comparer deux machines : une pente « par heure » n'a de sens qu'à
// débit égal, et deux plateformes ne servent jamais le même débit. Rapportée au
// MILLION DE REQUÊTES, la hausse devient une propriété du code — pas du poste.
const reqTotal = kept.reduce((n, s) => n + s.rps * WINDOW, 0);
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
  `  débit  : ${Math.round(rpsFirst)} → ${Math.round(rpsLast)} rps (${drift >= 0 ? "+" : ""}${drift.toFixed(1)} %)` +
    // Le RÉGIME de charge qualifie tout ce qui précède : « RSS plat » sous
    // 400 rps et « RSS plat » sous 10 000 rps ne disent pas la même chose, et
    // un banc qui tait son débit laisse lire le premier comme le second.
    ` · médiane ${Math.round(rpsMedian)} rps`,
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

// ── 🔴 A-T-ON MESURÉ CE QU'ON A DEMANDÉ ? ──────────────────────────────────
//
// `tooShort` compare la durée observée à un plancher ABSOLU (10 min) — jamais à
// la durée DEMANDÉE. Un run de 90 min coupé à la 37ᵉ fenêtre franchissait donc
// ce plancher avec 15,7 min et rendait `verdict: "clean"`, exit 0 : le banc
// ACQUITTAIT le produit sur 17 % du travail commandé, sans que rien dans sa
// sortie ni dans son JSON ne trahisse la troncature. C'est le pire des faux
// verdicts — il ferme la question au lieu de la poser, et un rapport, la forge
// ou le prochain lecteur y liront « pas de fuite ».
//
// Une fuite lente se cherche par la DURÉE : un run tronqué ne rend pas une
// mesure « un peu plus courte », il rend une mesure qui ne répond plus à la
// question posée (palier ou hausse sans fin ?). Il se déclare INCOMPLET, et
// sort en code ≠ 0 — règle n°1 §5 de ce skill, qu'il s'appliquait à tous sauf
// à lui-même.
const tronque = samples.length < WINDOWS;
const couverturePct = (samples.length / WINDOWS) * 100;

const leaking =
  !tooShort &&
  heap.perHour > 20 &&
  heap.r2 > 0.7 &&
  amplitude >= MIN_AMPLITUDE_MB;
const degrading = drift < -10;
if (tronque) {
  console.log(
    `\n  ⊘ RUN TRONQUÉ — ${samples.length} fenêtres sur ${WINDOWS} demandées` +
      ` (${observedMin.toFixed(1)} min retenues sur ${MINUTES}, ${couverturePct.toFixed(0)} % du run).` +
      `\n    Ce qui suit décrit ce fragment, PAS le run commandé : une fuite lente se cherche` +
      `\n    par la durée, et le palier éventuel se situe peut-être au-delà de ce qu'on a vu.` +
      `\n    Verdict INCOMPLET — à rejouer entier avant d'en conclure quoi que ce soit.`,
  );
}
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

/**
 * OÙ va la hausse du RSS — la question que « le RSS monte » ne répond pas.
 *
 * Le RSS d'un process Node se décompose grossièrement en trois postes que la
 * sonde rend séparément : le tas RÉSERVÉ par V8 (`heapTotal`, qui peut croître
 * alors que `heapUsed` reste plat — V8 garde ses arènes), la mémoire EXTERNE
 * (`external` : tampons, `ArrayBuffer`, ressources natives rattachées), et tout
 * le reste (code, piles, fragmentation de l'allocateur système).
 *
 * Chacun envoie chercher à un endroit DIFFÉRENT, et sans cette ventilation le
 * diagnostic se résume à « ça monte » — ce qui ne conduit nulle part.
 */
const dHeapTotal = kept[kept.length - 1].heapTotalMb - kept[0].heapTotalMb || 0;
const dExternal = kept[kept.length - 1].externalMb - kept[0].externalMb || 0;
const dRss = kept[kept.length - 1].rssMb - kept[0].rssMb;
const reste = dRss - dHeapTotal - dExternal;
const part = (x) => (dRss ? `${((x / dRss) * 100).toFixed(0)} %` : "—");
const decomposition =
  Number.isFinite(dHeapTotal) && Number.isFinite(dExternal)
    ? `Ventilation des +${dRss.toFixed(1)} MB : tas RÉSERVÉ ${dHeapTotal >= 0 ? "+" : ""}${dHeapTotal.toFixed(1)} MB (${part(dHeapTotal)}) · ` +
      `externe ${dExternal >= 0 ? "+" : ""}${dExternal.toFixed(1)} MB (${part(dExternal)}) · ` +
      `reste ${reste >= 0 ? "+" : ""}${reste.toFixed(1)} MB (${part(reste)}, code/piles/fragmentation).` +
      `\n    ${
        Math.abs(dExternal) > Math.abs(dHeapTotal) &&
        Math.abs(dExternal) > Math.abs(reste)
          ? "→ dominante EXTERNE : chercher des tampons ou des ressources natives retenus."
          : Math.abs(dHeapTotal) > Math.abs(reste)
            ? "→ dominante TAS RÉSERVÉ : V8 garde ses arènes ; regarder si `heapUsed` plafonne, auquel cas c'est bénin."
            : "→ dominante RESTE : hors V8 — fragmentation de l'allocateur, piles, ou natif non rattaché."
      }`
    : "Ventilation indisponible (échantillons sans heapTotal/external).";
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
      `\n    Le TAS est ${leaking ? "lui aussi en hausse" : "stable"}.` +
      `\n    ${decomposition}` +
      `\n    Relancer plus long (--minutes 90) tranche entre montée vers un palier et hausse sans fin.`,
  );
}
// ── Les ressources ouvertes : la famille de causes qu'on peut ÉLIMINER ────
//
// C'est le seul poste de cette liste qui, s'il bouge, désigne un défaut PRODUIT
// et non une propriété de l'allocateur : des sockets, des timers ou des flux
// que le pipeline n'a pas rendus. Stable, il fait tomber toute cette famille
// d'un coup — ce qui vaut largement l'appel d'une API par fenêtre.
// 🔴 On compare des PLANCHERS, jamais deux instantanés. Une fenêtre est
// échantillonnée tantôt pendant une rafale `wrk` (c64 ⇒ ~66 sockets vivantes),
// tantôt entre deux — deux régimes que rien ne distingue dans un relevé isolé.
// Vécu : `21 → 73 (+52)`, accompagné de « c'est un défaut PRODUIT », sur un
// serveur où les handles OSCILLAIENT (6, 72, 5, 73, 29, 72, 73) et dont le
// plancher valait 5 au début comme à la fin. L'instrument accusait le produit.
// Le plancher, lui, est l'état AU REPOS : s'il monte, quelque chose n'est pas
// rendu ; s'il est stable, rien ne s'accumule — quel que soit le maximum.
const TRANCHE = Math.max(5, Math.min(20, Math.floor(kept.length / 4)));
const plancher = (echantillons) => {
  const v = echantillons.map((x) => x.handlesTotal).filter((x) => x != null);
  return v.length ? Math.min(...v) : null;
};
const typesAuPlancher = (echantillons) => {
  const v = echantillons.filter((x) => x.handlesTotal != null);
  if (!v.length) return {};
  const bas = v.reduce(
    (m, x) => (x.handlesTotal < m.handlesTotal ? x : m),
    v[0],
  );
  return bas.handlesByType ?? {};
};
const h0 = plancher(kept.slice(0, TRANCHE));
const h1 = plancher(kept.slice(-TRANCHE));
let handlesDelta = null;
let handlesGrowth = null;
if (h0 === null || h1 === null) {
  console.log(
    `\n  handles : non mesurés — la sonde ${PROBE} ne rend pas` +
      ` \`activeResourcesTotal\`. Serveur bâti avant cet ajout ?`,
  );
} else {
  handlesDelta = h1 - h0;
  const a = typesAuPlancher(kept.slice(0, TRANCHE));
  const b = typesAuPlancher(kept.slice(-TRANCHE));
  handlesGrowth = Object.fromEntries(
    Object.keys({ ...a, ...b })
      .map((k) => [k, (b[k] ?? 0) - (a[k] ?? 0)])
      .filter(([, d]) => d !== 0),
  );
  const detail = Object.entries(handlesGrowth)
    .map(([k, d]) => `${k} ${d >= 0 ? "+" : ""}${d}`)
    .join(" · ");
  console.log(
    `\n  handles : plancher ${h0} → ${h1} (${handlesDelta >= 0 ? "+" : ""}${handlesDelta})` +
      ` · sur ${TRANCHE} fenêtres de chaque bout, hors rafale` +
      (detail ? `\n            ${detail}` : " — aucun type n'a bougé") +
      (handlesDelta > 0
        ? `\n            ⚠ des ressources s'accumulent : c'est un défaut PRODUIT, pas de l'allocateur.`
        : `\n            ✅ rien ne s'accumule — sockets, timers et flux sont rendus.`),
  );
}

// ── LE DÉCOR A-T-IL TENU PENDANT LA MESURE ? ──────────────────────────────
//
// Un banc qui découvre APRÈS COUP qu'un tiers partageait la machine a produit
// un chiffre, pas une mesure. Deux signaux gratuits, relevés à chaque fenêtre :
//
//   · la CHARGE de la machine — si elle grimpe en cours de route, quelqu'un
//     d'autre travaille, et le débit qu'on lit n'est plus celui du serveur ;
//   · le nombre de CONNEXIONS au serveur — ce banc en ouvre un nombre CONSTANT
//     (`--conn`), donc toute connexion en plus vient d'ailleurs. C'est ce qui a
//     faussé un run de 90 minutes : une console d'administration ouverte dans
//     un navigateur tapait sur le process mesuré, faisant monter le TAS — et
//     un tas qui monte, c'est précisément la signature qu'on traquait.
const charges = kept.map((s) => s.charge).filter((c) => typeof c === "number");
const socketsVus = kept
  .map((s) => s.sockets)
  .filter((n) => typeof n === "number");
const decor = [];
if (charges.length) {
  const chargeMax = Math.max(...charges);
  if (chargeMax > chargeInitiale + COEURS * 0.5) {
    decor.push(
      `la charge machine est montée à ${chargeMax.toFixed(2)} (départ ${chargeInitiale.toFixed(2)},` +
        ` ${COEURS} cœurs) — un tiers a travaillé pendant la mesure`,
    );
  }
}
if (socketsVus.length) {
  const socketsMax = Math.max(...socketsVus);
  // Marge large : le serveur porte aussi ses propres sockets (écoute, sondes).
  // Ce qu'on cherche est un DÉPASSEMENT franc, pas quelques unités.
  if (socketsMax > CONN + 16) {
    decor.push(
      `jusqu'à ${socketsMax} connexions ouvertes alors que le banc en ouvre ${CONN}` +
        ` — quelqu'un d'autre a sollicité le serveur MESURÉ`,
    );
  }
}
if (decor.length) {
  console.log(
    `\n  ⚠ DÉCOR NON TENU — le verdict ci-dessus porte sur autre chose que ce banc seul :`,
  );
  for (const d of decor) console.log(`      • ${d}`);
  console.log(
    `    Rejouer machine libre. Un décor partagé ne dégrade pas la mesure : il en change l'objet.`,
  );
}

// ── LA grandeur qui traverse les machines ─────────────────────────────────
//
// « +33 MB/h » ne se compare à rien : le même code sur un runner partagé qui
// sert cinq fois moins de requêtes rendra cinq fois moins de MB/h, et l'on
// conclurait « cette plateforme ne fuit pas » alors qu'elle fuit pareil. Ce que
// l'on cherche est un coût MÉMOIRE PAR REQUÊTE SERVIE — invariant du débit,
// donc comparable entre un poste de développement et la forge.
const rssPerMreq = reqTotal > 0 ? dRss / (reqTotal / 1e6) : 0;
// ⚠️ Ce ratio n'est valide qu'au RÉGIME ÉTABLI. Sur un run court il englobe la
// montée initiale — caches qui se remplissent, arènes qui s'ouvrent — et sort
// un chiffre plusieurs fois trop gros (mesuré : 6,42 sur 1,3 min contre 0,87
// sur 30 min, même machine, même route). Le publier nu sous un verdict
// « indéterminé » en ferait un fait ; on le retient donc exactement là où le
// reste du verdict se retient.
console.log(
  `\n  charge : ${(reqTotal / 1e6).toFixed(2)} M requêtes servies pendant les fenêtres retenues` +
    (tooShort
      ? `\n           (coût mémoire par requête NON publié : sous ${MIN_MINUTES} min il` +
        ` englobe la montée en régime et sort plusieurs fois trop gros)`
      : `\n           ⇒ RSS ${dRss >= 0 ? "+" : ""}${rssPerMreq.toFixed(2)} MB par million de requêtes` +
        ` (grandeur COMPARABLE d'une machine à l'autre, contrairement aux MB/h)`),
);

console.log(
  `\n  ⚠ ${MINUTES} min ne prouvent pas 3 jours : ce banc élimine les fuites grossières, pas les lentes.`,
);

writeFileSync(
  OUT,
  JSON.stringify(
    {
      url: URL,
      minutes: MINUTES,
      // Ce qui a été DEMANDÉ face à ce qui a été FAIT, côte à côte : un lecteur
      // qui ne compare pas lui-même `observedMinutes` à `minutes` ne doit pas
      // pouvoir prendre un fragment pour le run entier.
      windowsDemandees: WINDOWS,
      windowsObservees: samples.length,
      tronque,
      windowSec: WINDOW,
      conn: CONN,
      skipped: SKIP,
      node: process.version,
      // Le décor VIRTUALISÉ, constaté et non déduit : une VM d'hyperviseur qui
      // réserve des vCPU ne se voit PAS dans `loadavg`, et fait pourtant chuter
      // le débit de dizaines de pour cent. Sans ce champ, deux runs de la même
      // commande sur la même machine se comparent alors qu'ils n'ont pas le même
      // décor — c'est arrivé, à 40 % d'écart de débit.
      vcpuVirtualises: VCPU_VIRTUALISES,
      samples,
      heapSlopeMbPerHour: +heap.perHour.toFixed(2),
      heapR2: +heap.r2.toFixed(3),
      rssSlopeMbPerHour: +rss.perHour.toFixed(2),
      // Les bornes des fenêtres RETENUES, celles-là mêmes sur lesquelles la
      // pente est ajustée. `samples[0]` est la première fenêtre TOUT COURT,
      // montée en régime comprise : l'afficher à côté de la pente ferait lire
      // deux périodes différentes dans une seule ligne.
      rssKeptFirstMb: kept[0].rssMb,
      rssKeptLastMb: kept[kept.length - 1].rssMb,
      rssR2: +rss.r2.toFixed(3),
      rssSlopeLateMbPerHour: +rssLate.perHour.toFixed(2),
      rssPlateau: plateau,
      // La ventilation, pour qu'un run puisse être RELU sans être rejoué.
      rssDeltaMb: +dRss.toFixed(1),
      heapTotalDeltaMb: +dHeapTotal.toFixed(1),
      externalDeltaMb: +dExternal.toFixed(1),
      resteDeltaMb: +reste.toFixed(1),
      rpsDriftPct: +drift.toFixed(1),
      rpsMedian: Math.round(rpsMedian),
      chargeInitiale: +chargeInitiale.toFixed(2),
      chargeMax: charges.length ? Math.max(...charges) : null,
      socketsMax: socketsVus.length ? Math.max(...socketsVus) : null,
      coeurs: COEURS,
      decorTenu: decor.length === 0,
      requestsTotal: Math.round(reqTotal),
      handlesFirst: h0,
      handlesLast: h1,
      handlesDelta,
      handlesGrowthByType: handlesGrowth,
      rssMbPerMillionReq: tooShort ? null : +rssPerMreq.toFixed(3),
      observedMinutes: +observedMin.toFixed(1),
      amplitudeMb: +amplitude.toFixed(1),
      // `tronque` PRIME sur tout le reste : on ne peut pas acquitter (ni
      // condamner) sur un run qui n'a pas eu lieu.
      verdict: tronque
        ? "incomplet"
        : tooShort
          ? "indeterminate"
          : leaking
            ? "leak"
            : "clean",
    },
    null,
    2,
  ),
);
console.log(`  données : ${OUT}`);

// Un banc qui n'a pas fait le travail commandé ne doit pas RESSEMBLER à un banc
// réussi — ni pour la forge, ni pour un `&&` dans un enchaînement, ni pour un
// agent qui lit un code de sortie. (⚠️ vérifier cet exit SANS pipe : sous zsh,
// `$?` après un pipe est celui du dernier maillon.)
if (tronque) process.exit(2);
