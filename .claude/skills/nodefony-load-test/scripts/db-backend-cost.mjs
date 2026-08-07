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
 *     LATENCE EST son blocage, en un seul morceau ;
 *   • PostgreSQL (node-postgres) rend la main pendant l'attente réseau, mais
 *     consomme du CPU sur ce même thread pour écrire et surtout PARSER le
 *     protocole — un blocage réel, simplement fractionné et invisible à la
 *     latence. C'est ce CPU qui borne le débit d'un process, pas l'attente.
 *
 * Le banc mesure donc les deux : la latence (ce que le client attend) ET le CPU
 * du thread principal par requête (ce qui plafonne le process). Chacun rend son
 * plafond `1 ÷ temps de boucle`, seule grandeur comparable entre les deux.
 *
 * ⚠️ CE QUE CE BANC N'EST PAS. Il n'exerce ni le pipeline HTTP ni l'ORM, et
 * compare une base EN MÉMOIRE à une base CONTENEURISÉE : c'est une comparaison de
 * DÉPLOIEMENTS, pas de moteurs. Ses chiffres servent à EXPLIQUER un banc de
 * charge, jamais à le remplacer ni à annoncer un débit de framework.
 *
 * Usage (depuis la RACINE du dépôt) :
 *   node .claude/skills/nodefony-load-test/scripts/db-backend-cost.mjs
 *   NF_PG_URL=postgres://user:pass@host:5432/db node …/db-backend-cost.mjs
 *   ROWS=50000 REPS=1000 SERIES=5 node …/db-backend-cost.mjs
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
 * ⚠️ TROIS instruments ont été pris en défaut ici avant celui-ci — d'où ce garde-fou
 * écrit. (1) `setInterval(2ms)` + `setTimeout(0)` : Node borne un délai de 0 à ~1 ms,
 * on mesurait la granularité du minuteur (« SQLite bloque 0,43 ms » pour une requête
 * de 33 µs). (2) `monitorEventLoopDelay` : résolution ~1 ms, aveugle à quelques
 * dizaines de µs — les deux pilotes rendaient son propre plancher. (3) Pire : la
 * colonne « bloque la boucle ? non » pour PostgreSQL, une assertion JAMAIS mesurée
 * présentée comme un résultat, alors que son pilote consomme ~300 µs de CPU par
 * requête. Un banc qui n'a pas mesuré doit se taire, pas répondre « non ».
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
