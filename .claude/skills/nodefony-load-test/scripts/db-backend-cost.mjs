#!/usr/bin/env node
/**
 * db-backend-cost — ce qu'un backend de base de données coûte AU SERVEUR, et non
 * ce qu'il coûte en lui-même.
 *
 * Répond à une question qui paraît contradictoire : « SQLite est synchrone donc
 * il bloque la boucle, mais il rend plus de RPS que PostgreSQL — lequel est le
 * goulot ? » Les deux affirmations sont vraies et ne parlent pas de la même
 * chose. Ce qui départage n'est pas « synchrone vs asynchrone » mais le TEMPS DE
 * BOUCLE CONSOMMÉ PAR REQUÊTE, que les deux pilotes paient de façons différentes :
 *
 *   • SQLite (better-sqlite3) exécute la requête sur le thread principal : sa
 *     LATENCE EST son blocage, en un seul morceau. Démontré par `--prove` ;
 *   • PostgreSQL (node-postgres) rend la main pendant l'attente réseau : celle-ci
 *     ne bloque RIEN. Son pilote consomme bien du CPU pour analyser le protocole,
 *     mais ce coût-là ne se déduit PAS d'une mesure de latence, et il ne suffit
 *     pas à prédire un plafond.
 *
 * ⚠️ CE QUE CE BANC N'EST PAS — et ce qu'il a fallu apprendre deux fois. Le mode
 * par défaut mesure des requêtes UNE À UNE : il ne dit RIEN de ce qui plafonne un
 * serveur. En déduire un « plafond = 1 ÷ CPU » a produit ici deux explications
 * fausses d'affilée. Le plafond se MESURE (`--ceiling`) : on monte le pool jusqu'à
 * ce que le débit cesse de suivre, puis on DEMANDE à la base si elle est au bout
 * (`pg_stat_activity` échantillonné PENDANT la charge, `pgbench` dans le conteneur).
 * Sur ce dépôt, la réponse était non : les 40 backends attendaient le client et la
 * base rendait 12 900 tps en interne contre ~5 400 depuis l'hôte — c'est le chemin
 * VIRTUALISÉ de Docker Desktop qui bornait, pas PostgreSQL.
 *
 * Il n'exerce ni le pipeline HTTP ni l'ORM, et compare une base EN MÉMOIRE à une
 * base CONTENEURISÉE : c'est une comparaison de DÉPLOIEMENTS, pas de moteurs. Ses
 * chiffres EXPLIQUENT un banc de charge, ils ne le remplacent pas et n'annoncent
 * aucun débit de framework.
 *
 * Usage (depuis la RACINE du dépôt) :
 *   node …/db-backend-cost.mjs             # latence et CPU par requête
 *   node …/db-backend-cost.mjs --prove     # DÉMONTRE qui bloque la boucle
 *   node …/db-backend-cost.mjs --ceiling   # MESURE ce qui plafonne, et désigne le coupable
 *   NF_PG_URL=… ROWS=50000 REPS=1000 SERIES=5 CONC=50 SEC=3 node …/db-backend-cost.mjs
 */
import net from "node:net";

const REPS = Number(process.env.REPS ?? 400);
const ROWS = Number(process.env.ROWS ?? 10_000);
const SERIES = Number(process.env.SERIES ?? 3);
const LIMIT = 20;
const PG_URL =
  process.env.NF_PG_URL ??
  process.env.NF_DATABASE_URL ??
  "postgres://nodefony:nodefony-dev@127.0.0.1:5432/nodefony";

const sorted = (a) => [...a].sort((x, y) => x - y);
const med = (a) => sorted(a)[Math.floor(a.length / 2)];
const p99 = (a) => sorted(a)[Math.floor(a.length * 0.99)];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** Rend la main à la boucle SANS le plancher de 1 ms d'un `setTimeout(0)`. */
const yieldLoop = () => new Promise((r) => setImmediate(r));

/**
 * ⚠️ QUATRE instruments ont été pris en défaut ici — d'où ce garde-fou écrit.
 * (1) `setInterval(2ms)` + `setTimeout(0)` : Node borne un délai de 0 à ~1 ms, on
 * mesurait la granularité du minuteur (« SQLite bloque 0,43 ms » pour une requête de
 * 33 µs). (2) `monitorEventLoopDelay` : résolution ~1 ms, aveugle à quelques dizaines
 * de µs — les deux pilotes rendaient son propre plancher. (3) Une colonne « bloque la
 * boucle ? non » : une assertion JAMAIS mesurée présentée comme un résultat. (4) Ce
 * `process.cpuUsage()` : il compte TOUS les fils, GC compris — sur une réponse
 * volumineuse il a rendu 110 % du temps mural. C'est un MAJORANT du travail de boucle,
 * jamais un plafond de débit : pour cela, `--ceiling`.
 * Un banc qui n'a pas mesuré doit se taire, pas répondre « non ».
 */
const cpuNow = () => {
  const c = process.cpuUsage();
  return c.user + c.system; // µs
};

function stats(lat, cpuTotalUs, reps) {
  const cpuPerReq = cpuTotalUs / reps;
  return {
    latMed: med(lat),
    latP99: p99(lat),
    cpuPerReq,
    ceiling: Math.round(1e6 / cpuPerReq),
  };
}

const results = {
  reps: REPS,
  rows: ROWS,
  series: SERIES,
  node: process.version,
};
const fail = [];

// ── Mode --prove : la DÉMONSTRATION, pas la mesure ──────────────────────────
// Quatre instruments se sont trompés sur « qui bloque la boucle ». Celui-ci ne
// peut pas : il arme un rappel AVANT la requête et regarde quand il part. Si la
// requête bloque, le rappel ne peut pas partir avant la fin — l'effet est à
// l'échelle de la centaine de millisecondes, hors de portée du bruit.
if (process.argv.includes("--prove")) {
  const msSince = (t0) => Number(process.hrtime.bigint() - t0) / 1e6;
  const armCallback = () => {
    const t0 = process.hrtime.bigint();
    return new Promise((r) => setImmediate(() => r(msSince(t0))));
  };
  console.log(`\n=== PREUVE — qui bloque la boucle d'événements ? ===\n`);
  let bad = 0;

  const { default: Database } = await import("better-sqlite3");
  const db = new Database(":memory:");
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v INTEGER)");
  const ins = db.prepare("INSERT INTO t (v) VALUES (?)");
  db.transaction(() => {
    for (let i = 0; i < 2_000_000; i++) ins.run(i);
  })();
  const heavy = db.prepare("SELECT sum(v) AS s FROM t WHERE v % 7 = ?");
  heavy.get(1);
  {
    const pending = armCallback();
    const t0 = process.hrtime.bigint();
    const row = heavy.get(1);
    const duree = msSince(t0);
    const retard = await pending;
    const bloque = retard > duree * 0.8;
    console.log(`SQLite — somme sur 2 M lignes (pilote synchrone)`);
    console.log(
      `  requête ${duree.toFixed(0)} ms · rappel armé avant : retard ${retard.toFixed(0)} ms`,
    );
    console.log(
      `  → ${bloque ? "BLOQUE" : "ne bloque pas"} — le rappel a dû attendre la fin\n`,
    );
    if (row?.s === undefined || !bloque) bad++;
  }
  db.close();

  const { default: pg } = await import("pg");
  const c = new pg.Client({ connectionString: PG_URL });
  await c.connect();
  await c.query("SELECT pg_sleep(0.05)");
  {
    const pending = armCallback();
    const t0 = process.hrtime.bigint();
    const res = await c.query("SELECT pg_sleep(0.5) AS s");
    const duree = msSince(t0);
    const retard = await pending;
    const libre = retard < duree * 0.1;
    console.log(
      `PostgreSQL — 500 ms de travail CÔTÉ SERVEUR (pilote asynchrone)`,
    );
    console.log(
      `  requête ${duree.toFixed(0)} ms · rappel armé avant : retard ${retard.toFixed(2)} ms`,
    );
    console.log(
      `  → ${libre ? "NE BLOQUE PAS" : "bloque"} — le rappel est parti pendant l'attente\n`,
    );
    if (!res.rows.length || !libre) bad++;
  }
  await c.end();

  console.log(
    bad === 0
      ? `✅ les deux démonstrations passent — la distinction latence / blocage tient.\n`
      : `✖ ${bad} démonstration(s) en échec — la machine ou l'instrument est en cause.\n`,
  );
  process.exit(bad === 0 ? 0 : 1);
}

// ── Mode --ceiling : QUI plafonne, sous charge réelle ───────────────────────
// Le mode par défaut mesure des requêtes UNE À UNE : il ne peut pas dire ce qui
// borne un serveur. Ce mode-ci monte la taille du pool jusqu'à ce que le débit
// cesse de suivre, puis DÉSIGNE le coupable — et refuse de conclure « la base
// sature » sans l'avoir demandé à la base elle-même. C'est ce contrôle qui a
// réfuté deux explications successives sur ce dépôt.
if (process.argv.includes("--ceiling")) {
  const { default: pg } = await import("pg");
  const { execFileSync } = await import("node:child_process");
  const CONC = Number(process.env.CONC ?? 50);
  const SEC = Number(process.env.SEC ?? 3);
  const CTN = process.env.PG_CONTAINER ?? "nodefony-postgres";

  const setup = new pg.Client({ connectionString: PG_URL });
  await setup.connect();
  await setup.query("DROP TABLE IF EXISTS bench_plafond");
  await setup.query(
    `CREATE TABLE bench_plafond AS SELECT g AS v, 'row-'||g AS name FROM generate_series(1,$1) g`,
    [ROWS],
  );
  await setup.query("ANALYZE bench_plafond");
  await setup.end();
  const SQL = `SELECT * FROM bench_plafond WHERE v > $1 LIMIT ${LIMIT}`;

  /** Échantillonne l'état des backends PENDANT la charge — hors charge, la
   *  question n'a aucun sens : les connexions sont refermées et la sonde
   *  répondrait sans avoir rien observé. */
  const sampleBackends = () => {
    try {
      return execFileSync(
        "docker",
        [
          "exec",
          "-i",
          CTN,
          "psql",
          "-U",
          "nodefony",
          "-d",
          "nodefony",
          "-tAc",
          "SELECT count(*) FILTER (WHERE wait_event='ClientRead') || ' sur ' || count(*) " +
            "FROM pg_stat_activity WHERE datname='nodefony' AND pid <> pg_backend_pid()",
        ],
        { encoding: "utf8" },
      ).trim();
    } catch {
      return null;
    }
  };

  async function debit(source, observe = false) {
    let ok = 0;
    // Objet plutôt que booléen : la condition est modifiée hors de la boucle,
    // ce qu'une analyse statique ne peut pas voir sur une variable simple.
    const run = { on: true };
    const w = async () => {
      while (run.on) {
        const r = await source.query(SQL, [
          Math.floor(Math.random() * (ROWS - LIMIT)),
        ]);
        if (r.rows.length !== LIMIT) throw new Error("travail non prouvé");
        ok++;
      }
    };
    await Promise.all(
      Array.from({ length: CONC }, () => source.query(SQL, [1])),
    );
    const t0 = process.hrtime.bigint();
    const c0 = process.cpuUsage();
    const running = Array.from({ length: CONC }, w);
    let backends = null;
    if (observe) {
      await new Promise((r) => setTimeout(r, (SEC * 1000) / 2));
      backends = sampleBackends(); // au MILIEU de la charge
      await new Promise((r) => setTimeout(r, (SEC * 1000) / 2));
    } else {
      await new Promise((r) => setTimeout(r, SEC * 1000));
    }
    run.on = false;
    await Promise.all(running);
    const sec = Number(process.hrtime.bigint() - t0) / 1e9;
    const c = process.cpuUsage(c0);
    return {
      rps: ok / sec,
      nodeCpuPct: (c.user + c.system) / 1000 / sec / 10,
      backends,
    };
  }

  console.log(
    `\n=== QUI plafonne ? (${CONC} requêtes en vol, ${SEC} s par palier) ===\n`,
  );
  console.log(`pool          débit        CPU du process Node`);
  console.log("─".repeat(52));
  const paliers = [];
  for (const max of [5, 10, 20, 40]) {
    const pool = new pg.Pool({ connectionString: PG_URL, max });
    const r = await debit(pool, max === 40); // on observe la base au palier le plus haut
    await pool.end();
    paliers.push({ max, ...r });
    console.log(
      `Pool(${String(max).padEnd(2)})  ${r.rps.toFixed(0).padStart(9)} req/s   ${r.nodeCpuPct.toFixed(0).padStart(6)} % d'un cœur`,
    );
  }
  const der = paliers[paliers.length - 1],
    avd = paliers[paliers.length - 2];
  const gain = (der.rps - avd.rps) / avd.rps;
  console.log(
    `\nDoubler le pool (${avd.max}→${der.max}) rend ${(gain * 100).toFixed(0)} % :` +
      ` ${gain < 0.1 ? "l'attente n'est PLUS le facteur limitant" : "l'attente borne encore — monter le pool"}.`,
  );

  // ⚠️ LE contrôle qui manquait : demander à la base si elle est vraiment au bout.
  console.log(
    `\n--- la base est-elle VRAIMENT saturée ? (sans ça, on conclut à tort) ---`,
  );
  if (der.backends) {
    console.log(
      `  backends en attente du CLIENT, relevés PENDANT la charge : ${der.backends}` +
        `\n    (une majorité en attente = la base n'est pas le goulot)`,
    );
  } else {
    console.log(
      `  (pg_stat_activity non interrogeable — pas de verdict sur la base)`,
    );
  }
  try {
    execFileSync("docker", [
      "exec",
      "-i",
      CTN,
      "bash",
      "-c",
      `echo "SELECT * FROM bench_plafond WHERE v > 5000 LIMIT ${LIMIT};" > /tmp/q.sql`,
    ]);
    const out = execFileSync(
      "docker",
      [
        "exec",
        "-i",
        CTN,
        "pgbench",
        "-n",
        "-c",
        "20",
        "-j",
        "4",
        "-T",
        String(SEC + 3),
        "-M",
        "extended",
        "-f",
        "/tmp/q.sql",
        "nodefony",
        "-U",
        "nodefony",
      ],
      { encoding: "utf8" },
    );
    const tps = /tps = ([\d.]+)/.exec(out);
    if (tps) {
      const interne = Number(tps[1]);
      console.log(
        `  même requête DANS le conteneur (socket unix) : ${interne.toFixed(0)} tps`,
      );
      console.log(
        `  → facteur ${(interne / der.rps).toFixed(1)} entre l'intérieur et l'hôte : ` +
          `${interne / der.rps > 1.5 ? "le chemin VIRTUALISÉ borne, PAS la base" : "la base est bien au bout"}`,
      );
    }
  } catch {
    console.log(`  (pgbench indisponible dans le conteneur)`);
  }
  console.log();
  process.exit(0);
}

// ── SQLite — pilote SYNCHRONE ───────────────────────────────────────────────
try {
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(":memory:");
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, v INTEGER)");
  const ins = db.prepare("INSERT INTO t (name, v) VALUES (?, ?)");
  db.transaction(() => {
    for (let i = 0; i < ROWS; i++) ins.run(`row-${i}`, i);
  })();
  const sel = db.prepare(`SELECT * FROM t WHERE v > ? LIMIT ${LIMIT}`);
  for (let i = 0; i < 200; i++) sel.all(i);

  const runs = [];
  for (let s = 0; s < SERIES; s++) {
    const lat = [];
    const cpu0 = cpuNow();
    for (let i = 0; i < REPS; i++) {
      const t = process.hrtime.bigint();
      const rows = sel.all(i % (ROWS - LIMIT - 1));
      const d = Number(process.hrtime.bigint() - t) / 1000;
      // Preuve du travail : sans elle, une table vide se mesure très vite et
      // le banc publie un plafond flatteur qui ne repose sur rien.
      if (rows.length !== LIMIT) {
        throw new Error(
          `travail non prouvé — ${rows.length} lignes au lieu de ${LIMIT}`,
        );
      }
      if (i > 0) lat.push(d); // la 1ʳᵉ itération est un réveil post-repos
    }
    runs.push(stats(lat, cpuNow() - cpu0, REPS));
  }
  results.sqlite = runs;
  db.close();
} catch (e) {
  fail.push(`SQLite : ${e.message ?? e}`);
}

// ── PostgreSQL — pilote ASYNCHRONE ──────────────────────────────────────────
try {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: PG_URL });
  await client.connect();
  await client.query(
    "CREATE TEMP TABLE t (id serial primary key, name text, v int)",
  );
  await client.query(
    `INSERT INTO t (name, v) SELECT 'row-'||g, g FROM generate_series(1,$1) g`,
    [ROWS],
  );
  // Requête NOMMÉE : sans le nom, PostgreSQL replanifie à chaque appel et l'on
  // compare un motif préparé (SQLite) à un motif qui ne l'est pas — ~190 µs
  // d'iniquité mesurés.
  const q = (i) => ({
    name: "bench-sel",
    text: `SELECT * FROM t WHERE v > $1 LIMIT ${LIMIT}`,
    values: [i],
  });
  for (let i = 0; i < 200; i++) await client.query(q(i));

  const runs = [];
  for (let s = 0; s < SERIES; s++) {
    const lat = [];
    const cpu0 = cpuNow();
    for (let i = 0; i < REPS; i++) {
      const t = process.hrtime.bigint();
      const res = await client.query(q(i % (ROWS - LIMIT - 1)));
      const d = Number(process.hrtime.bigint() - t) / 1000;
      if (res.rows.length !== LIMIT) {
        throw new Error(
          `travail non prouvé — ${res.rows.length} lignes au lieu de ${LIMIT}`,
        );
      }
      if (i > 0) lat.push(d);
    }
    runs.push(stats(lat, cpuNow() - cpu0, REPS));
  }
  results.pg = runs;
  await client.end();
} catch (e) {
  fail.push(`PostgreSQL : ${e.message ?? e}`);
}

// ── Témoin : aller-retour TCP nu sur la boucle locale ────────────────────────
// ⚠️ Ce témoin ne traverse PAS Docker : il donne le plancher d'un aller-retour
// local, pas le coût de la frontière du conteneur. Il ne décompose rien.
async function roundTrip(port, host, n = 200) {
  const sock = await new Promise((res, rej) => {
    const s = net.connect(port, host, () => {
      s.setNoDelay(true);
      res(s);
    });
    s.on("error", rej);
  });
  return new Promise((resolve) => {
    const out = [];
    let t = 0n,
      i = 0;
    const tick = () => {
      if (i++ >= n) {
        sock.destroy();
        return resolve(out);
      }
      t = process.hrtime.bigint();
      sock.write("x");
    };
    sock.on("data", () => {
      out.push(Number(process.hrtime.bigint() - t) / 1000);
      tick();
    });
    tick();
  });
}
try {
  const srv = net.createServer((s) => {
    s.setNoDelay(true);
    s.on("data", (d) => s.write(d));
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  results.loopbackRt = med(await roundTrip(srv.address().port, "127.0.0.1"));
  srv.close();
} catch {
  /* témoin indisponible */
}

// ── Restitution ─────────────────────────────────────────────────────────────
console.log(`\n=== Ce qu'un backend de base coûte AU SERVEUR ===`);
console.log(
  `Node ${results.node} — ${SERIES} séries × ${REPS} lectures de ${LIMIT} lignes sur ${ROWS}\n`,
);
for (const f of fail) console.log(`⚠️  ${f}`);

if (!results.sqlite && !results.pg) {
  console.error("\n✖ aucun backend mesuré — rien à conclure");
  process.exit(1);
}

console.log(
  `pilote                latence (méd/p99)   CPU process/req   borne HAUTE côté Node`,
);
console.log("─".repeat(88));
const verdicts = {};
for (const [key, label] of [
  ["sqlite", "SQLite (synchrone)"],
  ["pg", "PostgreSQL (async)"],
]) {
  const runs = results[key];
  if (!runs) continue;
  const latMed = med(runs.map((r) => r.latMed));
  const latP99 = med(runs.map((r) => r.latP99));
  const cpu = med(runs.map((r) => r.cpuPerReq));
  const spread =
    (Math.max(...runs.map((r) => r.latMed)) -
      Math.min(...runs.map((r) => r.latMed))) /
    latMed;
  verdicts[key] = {
    latMed,
    latP99,
    cpu,
    ceiling: Math.round(1e6 / cpu),
    spread,
  };
  console.log(
    `${label.padEnd(20)} ${latMed.toFixed(0).padStart(7)} / ${latP99.toFixed(0).padStart(6)} µs   ` +
      `${cpu.toFixed(0).padStart(12)} µs   ${`~${Math.round(1e6 / cpu).toLocaleString("fr-FR")} req/s`.padStart(20)}` +
      (spread > 0.15 ? "  ⚠️ instable" : ""),
  );
}

if (results.loopbackRt) {
  console.log(
    `\ntémoin — aller-retour TCP nu en boucle locale : ${results.loopbackRt.toFixed(0)} µs` +
      ` (plancher local ; ne mesure NI la frontière du conteneur NI le protocole)`,
  );
}

for (const k of ["sqlite", "pg"]) {
  if (verdicts[k]?.spread > 0.15) {
    console.log(
      `\n⛔ ${k} : ${(verdicts[k].spread * 100).toFixed(0)} % d'écart entre séries — médiane non publiable, relancer machine calme.`,
    );
  }
}

console.log(
  `\nLire ces chiffres, et surtout ce qu'ils NE disent pas.\n` +
    `• SQLite : sa latence EST son blocage (travail synchrone sur le fil unique).\n` +
    `  Sa borne est donc réelle — prouvée en armant un rappel avant la requête :\n` +
    `  il part avec un retard égal à la durée de celle-ci.\n` +
    `• PostgreSQL : l'attente réseau ne bloque RIEN (même preuve, retard ~0 sur un\n` +
    `  pg_sleep de 500 ms). Le pilote consomme bien du CPU pour analyser le\n` +
    `  protocole, mais la colonne ci-dessus mesure le CPU du PROCESS (plusieurs\n` +
    `  fils, GC compris) : c'est un MAJORANT du travail de boucle, jamais le\n` +
    `  plafond de débit.\n` +
    `⚠️ Le plafond RÉEL ne se déduit pas d'ici : il se mesure sous charge, avec un\n` +
    `  Pool, en augmentant sa taille jusqu'à ce que le débit cesse de suivre.\n` +
    `  Éprouvé sur ce dépôt (macOS, Docker Desktop), et riche en fausses pistes :\n` +
    `  le débit plafonne mollement entre 4 400 et 6 500 req/s selon le jour, Node\n` +
    `  n'y consomme que ~50 % d'un cœur, et le conteneur ~460 %. Il est tentant d'en\n` +
    `  conclure que la base sature : c'est FAUX. Trois instruments le réfutent —\n` +
    `  \`pg_stat_activity\` montre les backends en \`ClientRead\` (ils ATTENDENT le\n` +
    `  client), \`pgbench\` dans le conteneur atteint ~14 400 tps sur la même requête\n` +
    `  et le même mode protocole, et un PostgreSQL réellement saturé fait monter le\n` +
    `  conteneur à ~800 %. Ce qui borne ici est le coût CPU du chemin réseau\n` +
    `  VIRTUALISÉ (VM + proxy de publication de port) dans une enveloppe hôte déjà\n` +
    `  pleine. Sur un déploiement Linux natif, ce plafond-là n'existe pas.\n`,
);

// Comparaison amputée = résultat partiel, jamais un succès silencieux.
if (!results.sqlite || !results.pg) {
  console.error("✖ comparaison incomplète — un seul pilote a pu être mesuré");
  process.exitCode = 1;
}

if (process.env.JSON_OUT) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(
    process.env.JSON_OUT,
    JSON.stringify({ ...results, verdicts }, null, 2),
  );
  console.log(`données écrites : ${process.env.JSON_OUT}\n`);
}
