// Banc CROSS-POD de l'idempotence distribuée Drizzle/PostgreSQL (axe 3, P6.8) — sans navigateur.
//
// LA preuve que SQLite ne peut PAS donner : sur un VRAI serveur Postgres partagé, deux « pods »
// (deux DrizzleOrm = deux pools de connexions distincts) qui lancent des `begin` CONCURRENTS sur
// la MÊME clé → exactement UN obtient `fresh`. L'atomicité vient de l'instruction
// `INSERT … ON CONFLICT(key) DO UPDATE … WHERE expiré RETURNING` exécutée par le serveur PG, pas
// du mono-thread JS (≠ SQLite mono-fichier, qui sérialise les connexions et ne prouve donc rien).
//
//   1. RÉSERVATION ATOMIQUE : 20 rounds × 10 `begin` concurrents (cross-pod, même clé) → 1 fresh/round.
//   2. REPLAY CROSS-POD      : pod A begin+complete → pod B `begin` rejoue la réponse de A (replayed).
//   3. MISMATCH CROSS-POD    : après complete, pod B `begin` avec un AUTRE payload → mismatch (422).
//   4. IN-FLIGHT CROSS-POD   : pod A réserve (sans complete) → pod B `begin` voit la réservation (409).
//
// Différentiel : avec le store `memory` (per-pod), chaque pod a sa propre Map → l'étape 1 donnerait
// 2 fresh, l'étape 2 un nouveau fresh sur B. Avec Postgres partagé → 1 fresh / un seul replay. C'est
// la dédup cross-pod façon Stripe, SANS Redis (pour un cluster qui a déjà une base SQL).
//
// Prérequis :
//   docker compose -f docker/docker-compose.yml --profile postgres up -d postgres   (pass "nodefony-dev")
//   npm run build -w @nodefony/drizzle   (le banc importe le dist)
// Lancement (racine repo) :
//   node .claude/skills/nodefony-load-test/scripts/idempotency-postgres-e2e.mjs
//   PG_URL=postgres://user:pass@host:5432/db node …/idempotency-postgres-e2e.mjs   (override)
import pg from "pg";
import {
  DrizzleOrm,
  DrizzleIdempotencyStore,
  registerIdempotencyEntities,
} from "@nodefony/drizzle";

const PG_URL =
  process.env.PG_URL ??
  "postgres://nodefony:nodefony-dev@127.0.0.1:5432/nodefony";

let pass = 0;
let fail = 0;
const ok = (cond, msg) => {
  if (cond) {
    pass++;
    console.log(`  ✅ ${msg}`);
  } else {
    fail++;
    console.error(`  ❌ ${msg}`);
  }
};

// — Sonde + nettoyage : skip PROPRE si Postgres injoignable (≠ échec du banc) —
const probe = new pg.Client({ connectionString: PG_URL });
try {
  await probe.connect();
  await probe.query("DROP TABLE IF EXISTS idempotency_key");
  await probe.end();
} catch (e) {
  console.error(`SKIP — Postgres injoignable (${PG_URL}) : ${e.message}`);
  console.error(
    "  → docker compose -f docker/docker-compose.yml --profile postgres up -d postgres",
  );
  process.exit(0);
}

// — Deux « pods » = deux DrizzleOrm postgres (pools distincts) sur la MÊME base —
registerIdempotencyEntities("pgpod_a", "postgres");
registerIdempotencyEntities("pgpod_b", "postgres");
const ormA = new DrizzleOrm("pgpod_a", { dialect: "postgres", url: PG_URL });
const ormB = new DrizzleOrm("pgpod_b", { dialect: "postgres", url: PG_URL });
await ormA.connect(); // crée la table (CREATE TABLE IF NOT EXISTS, DDL dérivé PG)
await ormB.connect(); // no-op sur la table (déjà créée), pool indépendant
const A = DrizzleIdempotencyStore.from(ormA);
const B = DrizzleIdempotencyStore.from(ormB);
console.log(`Connecté à ${PG_URL.replace(/\/\/[^@]+@/, "//***@")} — 2 pods\n`);

try {
  // 1) RÉSERVATION ATOMIQUE cross-pod : begins concurrents → 1 seul fresh/round.
  console.log(
    "1) Réservation atomique (20 rounds × 10 begins concurrents cross-pod)",
  );
  const ROUNDS = 20;
  const CONC = 10;
  let races = 0;
  for (let r = 0; r < ROUNDS; r++) {
    const key = `idem:race:${r}`;
    const outcomes = await Promise.all(
      Array.from({ length: CONC }, (_, i) =>
        (i % 2 === 0 ? A : B).begin(key, "fp"),
      ),
    );
    const fresh = outcomes.filter((o) => o.state === "fresh").length;
    const inflight = outcomes.filter((o) => o.state === "in-flight").length;
    if (fresh !== 1 || fresh + inflight !== CONC) {
      races++;
      console.error(
        `  round ${r}: ${fresh} fresh / ${inflight} in-flight (attendu 1 / ${CONC - 1})`,
      );
    }
  }
  ok(
    races === 0,
    `${ROUNDS} rounds : exactement 1 fresh + ${CONC - 1} in-flight par round (0 race)`,
  );

  // 2) REPLAY CROSS-POD : A réserve+complète, B rejoue la réponse de A.
  console.log("2) Replay cross-pod (A complete → B replayed)");
  const k2 = "idem:replay";
  const a1 = await A.begin(k2, "fp");
  ok(a1.state === "fresh", "A.begin(k) = fresh");
  await A.complete(k2, { status: 201, body: { who: "A", n: 42 } });
  const b1 = await B.begin(k2, "fp");
  ok(
    b1.state === "replayed" &&
      b1.response?.body?.who === "A" &&
      b1.response?.body?.n === 42,
    "B.begin(k) = replayed avec la réponse mémorisée par A (dédup cross-pod)",
  );
  ok(
    b1.response?.status === 201,
    "le statut mémorisé (201) est rejoué tel quel",
  );

  // 3) MISMATCH CROSS-POD : B rejoue la clé avec un AUTRE payload → 422.
  console.log("3) Mismatch cross-pod (empreinte préservée à la complétion)");
  const b2 = await B.begin(k2, "AUTRE-fp");
  ok(b2.state === "mismatch", "B.begin(k, autre fingerprint) = mismatch (422)");

  // 4) IN-FLIGHT CROSS-POD : A réserve sans compléter → B voit la réservation (409).
  console.log("4) In-flight cross-pod (réservation visible avant complétion)");
  const k4 = "idem:inflight";
  const a4 = await A.begin(k4, "fp");
  ok(a4.state === "fresh", "A.begin(k4) = fresh (réserve, sans complete)");
  const b4 = await B.begin(k4, "fp");
  ok(
    b4.state === "in-flight",
    "B.begin(k4) = in-flight (voit la réservation de A → 409)",
  );
} finally {
  await ormA.disconnect();
  await ormB.disconnect();
}

console.log(
  `\n${fail === 0 ? "✅ BANC VERT" : "❌ BANC ROUGE"} — ${pass} ok, ${fail} ko`,
);
process.exit(fail === 0 ? 0 : 1);
