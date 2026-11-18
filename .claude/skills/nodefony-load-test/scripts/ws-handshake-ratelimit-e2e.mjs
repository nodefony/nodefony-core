// Banc e2e du RATE-LIMIT du HANDSHAKE WebSocket (@nodefony/http, F5 revue 0.6) — sans navigateur.
//
// Prouve le CÂBLAGE bout-en-bout : l'upgrade WS EST une requête HTTP (GET + Upgrade)
// → il compte dans le MÊME compteur « rate-limit général par IP » que les requêtes
// HTTP (`HttpKernel.onWebsocketRequest` → résolution IP forwarded-aware → MemoryRateLimitStore).
// Au-delà du plafond IP : le handshake est refusé en `429` AVANT le `101` — la socket
// ne s'ouvre jamais (contrat : src/packages/@nodefony/http/docs/rate-limit.md).
//
// AVANT le fix : l'upgrade échappait au compteur → flood de handshakes illimité
// (200/200 sockets ouvertes, 0 rejet) = accumulation de sockets → flood de frames
// → famine event-loop. APRÈS : le flood est rejeté à la porte (429).
//
// Prérequis : serveur dev booté AVEC le rate-limit activé (seuil COURT pour un run net) :
//   NF__HTTP__RATELIMIT__ENABLED=true NF__HTTP__RATELIMIT__MAX=15 NF__HTTP__RATELIMIT__WINDOWS=30 \
//     bash .claude/skills/nodefony-start-server/start.sh
// Lancement (racine repo) :
//   node .claude/skills/nodefony-load-test/scripts/ws-handshake-ratelimit-e2e.mjs
// Env du banc : WS_URL (défaut wss://127.0.0.1:5152/nodefony/test/ws/echo)
//               HTTP_URL (défaut https://127.0.0.1:5152/nodefony/test/index) · N (défaut 40)
import WebSocket from "ws";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // loopback auto-signé (banc)

const WS_URL =
  process.env.WS_URL ?? "wss://127.0.0.1:5152/nodefony/test/ws/echo";
const HTTP_URL =
  process.env.HTTP_URL ?? "https://127.0.0.1:5152/nodefony/test/index";
const N = Number(process.env.N ?? 40);
const numOrNull = (v) => (v === null ? null : Number(v));

async function httpHit() {
  const res = await fetch(HTTP_URL, { redirect: "manual" });
  await res.arrayBuffer().catch(() => {});
  return {
    status: res.status,
    limit: numOrNull(res.headers.get("x-ratelimit-limit")),
    remaining: numOrNull(res.headers.get("x-ratelimit-remaining")),
    reset: numOrNull(res.headers.get("x-ratelimit-reset")),
  };
}

// Un handshake WS : résout à { open, closeCode, status } — on ferme dès que possible
// pour ne pas garder de sockets ouvertes (le banc mesure le REJET, pas la charge).
// `status` = code HTTP d'un upgrade REFUSÉ (`unexpected-response`, la socket ne
// s'ouvre pas) ; écouter cet événement oblige à abandonner la requête soi-même.
function handshake() {
  return new Promise((res) => {
    const ws = new WebSocket(WS_URL, { rejectUnauthorized: false });
    let done = false;
    const settle = (o) => {
      if (!done) {
        done = true;
        res(o);
      }
    };
    ws.on("open", () => {
      setTimeout(() => {
        try {
          ws.close();
        } catch {}
      }, 50);
    });
    ws.on("unexpected-response", (req, response) => {
      settle({ open: false, closeCode: null, status: response.statusCode });
      response.resume();
      req.destroy();
    });
    ws.on("close", (code) =>
      settle({ open: true, closeCode: code, status: null }),
    );
    ws.on("error", () =>
      settle({ open: false, closeCode: null, status: null }),
    );
  });
}

const fails = [];
const ok = (cond, msg) => {
  if (!cond) fails.push(msg);
};

// 1) Sonde : le rate-limit est-il actif ?
const probe = await httpHit();
if (probe.limit === null || Number.isNaN(probe.limit) || probe.limit === 0) {
  console.error(
    "✗ Rate-limit INACTIF (pas d'en-tête X-RateLimit-Limit).\n" +
      "  Relance le serveur avec :\n" +
      "  NF__HTTP__RATELIMIT__ENABLED=true NF__HTTP__RATELIMIT__MAX=15 NF__HTTP__RATELIMIT__WINDOWS=30 \\\n" +
      "    bash .claude/skills/nodefony-start-server/start.sh",
  );
  process.exit(2);
}
const MAX = probe.limit;
console.log(`Rate-limit actif — limit=${MAX}, ws=${WS_URL}`);

// 2) Preuve du COMPTEUR PARTAGÉ : un handshake WS décrémente le même quota que HTTP.
//    HTTP hit → remaining a ; 1 handshake WS ; HTTP hit → remaining b.
//    Si le WS partage le compteur, b a chuté d'AU MOINS 2 (le 2ᵉ HTTP + le WS)
//    entre les deux mesures — sinon d'1 seul (le 2ᵉ HTTP). Tolérant au bruit de fond
//    dev (qui ne peut que faire chuter davantage, jamais moins).
const a = (await httpHit()).remaining;
await handshake();
const b = (await httpHit()).remaining;
if (a !== null && b !== null) {
  console.log(`compteur partagé : remaining ${a} → (1 handshake WS) → ${b}`);
  ok(
    b <= a - 2,
    `le handshake WS décrémente le compteur IP partagé (remaining ${a}→${b}, attendu ≤ ${a - 2})`,
  );
}

// 3) FLOOD de N handshakes (une même IP) → au-delà du plafond, 429 avant le 101.
const results = [];
for (let i = 0; i < N; i += 1) results.push(await handshake());
const rejected429 = results.filter((r) => r.status === 429).length;
const opened = results.filter((r) => r.open).length;
const other = N - rejected429 - opened;

// 4) Assertions — chaque handshake a une issue NOMMÉE : ouvert sous le plafond,
//    ou refusé en 429. Une autre issue (erreur réseau, autre statut) n'est ni l'un
//    ni l'autre, et ne doit pas passer inaperçue.
ok(
  rejected429 >= 1,
  `≥ 1 handshake WS refusé par le rate-limit IP (429 avant le 101) — obtenu ${rejected429}`,
);
ok(
  other === 0,
  `aucune autre issue que « ouvert » ou « 429 » — obtenu ${other}`,
);

// 5) Rapport.
console.log(`\nFlood ${N} handshakes WS depuis une même IP :`);
console.log(`  refusés (429 avant le 101)       : ${rejected429}`);
console.log(`  ouverts (sous le plafond)        : ${opened}`);
console.log(`  autre issue                      : ${other}`);

if (fails.length) {
  console.error(`\n✗ ÉCHEC (${fails.length}) :`);
  fails.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}
console.log(
  "\n✓ Handshake WS e2e — le rate-limit IP couvre l'upgrade (compteur partagé HTTP+WS + 429 avant le 101).",
);
