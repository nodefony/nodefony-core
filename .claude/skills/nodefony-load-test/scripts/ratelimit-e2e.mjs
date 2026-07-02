// Banc e2e du RATE-LIMIT GÉNÉRAL par IP (@nodefony/http, P0.3) — sans navigateur.
//
// Prouve le CÂBLAGE bout-en-bout en HTTP RÉEL sur le vrai pipeline
// (`HttpKernel.onHttpRequest` → résolution IP → MemoryRateLimitStore → headers/429) :
//   - fenêtre fraîche : les `max` premières requêtes passent (200, `X-RateLimit-Remaining` décroît)
//   - au-delà du plafond : 429 (RFC 6585) + `Retry-After` (s) + `X-RateLimit-Remaining: 0`
//   - `X-RateLimit-Limit`/`-Reset` présents sur CHAQUE réponse
//
// Prérequis : serveur dev booté AVEC le rate-limit activé (seuil + fenêtre COURTS
// pour un run rapide et une preuve de transition nette) :
//   NF__HTTP__RATELIMIT__ENABLED=true NF__HTTP__RATELIMIT__MAX=5 NF__HTTP__RATELIMIT__WINDOWS=5 \
//     bash .claude/skills/nodefony-start-server/start.sh
// Lancement (racine repo) :
//   node .claude/skills/nodefony-load-test/scripts/ratelimit-e2e.mjs
// Env du banc : RL_URL (défaut http://127.0.0.1:5151/nodefony/test/index)

const URL = process.env.RL_URL ?? "http://127.0.0.1:5151/nodefony/test/index";
const numOrNull = (v) => (v === null ? null : Number(v));

async function hit() {
  const res = await fetch(URL, { redirect: "manual" });
  await res.arrayBuffer().catch(() => {}); // draine le corps (garde la socket propre)
  const h = (n) => res.headers.get(n);
  return {
    status: res.status,
    limit: numOrNull(h("x-ratelimit-limit")),
    remaining: numOrNull(h("x-ratelimit-remaining")),
    reset: numOrNull(h("x-ratelimit-reset")),
    retryAfter: numOrNull(h("retry-after")),
  };
}

const fails = [];
const ok = (cond, msg) => {
  if (!cond) fails.push(msg);
};

// 1) Sonde : le rate-limit est-il actif ? (header X-RateLimit-Limit présent)
const probe = await hit();
if (probe.limit === null || Number.isNaN(probe.limit) || probe.limit === 0) {
  console.error(
    "✗ Rate-limit INACTIF (pas d'en-tête X-RateLimit-Limit).\n" +
      "  Relance le serveur avec :\n" +
      "  NF__HTTP__RATELIMIT__ENABLED=true NF__HTTP__RATELIMIT__MAX=5 NF__HTTP__RATELIMIT__WINDOWS=5 \\\n" +
      "    bash .claude/skills/nodefony-start-server/start.sh",
  );
  process.exit(2);
}
const MAX = probe.limit;
console.log(`Rate-limit actif — limit=${MAX}, url=${URL}`);

// 2) Fenêtre fraîche : si le quota est déjà entamé (probe + bruit), attendre le
//    reset pour prouver la transition 200→429 depuis zéro.
if (probe.remaining !== null && probe.remaining < MAX - 1) {
  const waitMs = Math.max(0, (probe.reset ?? 0) * 1000 - Date.now()) + 300;
  console.log(
    `Attente reset (~${Math.ceil(waitMs / 1000)}s) → fenêtre fraîche…`,
  );
  await new Promise((r) => setTimeout(r, waitMs));
}

// 3) Rafale MAX+3 depuis la fenêtre fraîche (séquentielle → ordre déterministe).
const seq = [];
for (let i = 0; i < MAX + 3; i += 1) seq.push(await hit());

const allowed = seq.filter((r) => r.status === 200);
const limited = seq.filter((r) => r.status === 429);

// 4) Assertions.
ok(
  seq.every((r) => r.limit === MAX),
  "X-RateLimit-Limit == max sur toutes les réponses",
);
ok(allowed.length >= 1, "≥ 1 requête autorisée (200) en fenêtre fraîche");
ok(
  allowed.length <= MAX,
  `≤ max (${MAX}) requêtes autorisées (obtenu ${allowed.length})`,
);
ok(limited.length >= 1, "≥ 1 requête rejetée (429) après le plafond");
ok(
  limited.every((r) => r.remaining === 0),
  "429 → X-RateLimit-Remaining == 0",
);
ok(
  limited.every((r) => (r.retryAfter ?? 0) >= 1),
  "429 → Retry-After >= 1 (RFC 6585)",
);
const rem = allowed.map((r) => r.remaining);
ok(
  rem.every((v, i) => i === 0 || v < rem[i - 1]),
  `X-RateLimit-Remaining décroît sur les 200 (${rem.join(",")})`,
);

// 5) Rapport.
console.log(`\nSéquence (${seq.length} req depuis fenêtre fraîche) :`);
seq.forEach((r, i) =>
  console.log(
    `  #${i + 1} → HTTP ${r.status} | remaining=${r.remaining} reset=${r.reset} retry-after=${r.retryAfter ?? "-"}`,
  ),
);
console.log(`\n200=${allowed.length} · 429=${limited.length}`);

if (fails.length) {
  console.error(`\n✗ ÉCHEC (${fails.length}) :`);
  fails.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}
console.log(
  "\n✓ Rate-limit e2e — câblage prouvé (X-RateLimit-* + 429 + Retry-After + transition fenêtre).",
);
