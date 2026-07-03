// Banc e2e du RATE-LIMIT du HANDSHAKE WebSocket (@nodefony/http, F5 revue 0.6) — sans navigateur.
//
// Prouve le CÂBLAGE bout-en-bout : l'upgrade WS EST une requête HTTP (GET + Upgrade)
// → il compte dans le MÊME compteur « rate-limit général par IP » que les requêtes
// HTTP (`HttpKernel.onWebsocketRequest` → résolution IP forwarded-aware → MemoryRateLimitStore).
// Au-delà du plafond IP : le handshake ne peut plus répondre un 429 (le 101 est déjà
// émis par `ws`) → close RFC 6455 1013 « Try Again Later » (le client back-off + reconnecte).
//
// AVANT le fix : l'upgrade échappait au compteur → flood de handshakes illimité
// (200/200 sockets ouvertes, 0 rejet) = accumulation de sockets → flood de frames
// → famine event-loop. APRÈS : le flood est rejeté à la porte (close 1013).
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

// Un handshake WS : résout à { open, closeCode } — on ferme dès que possible pour
// ne pas garder de sockets ouvertes (le banc mesure le REJET, pas la charge).
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
    ws.on("close", (code) => settle({ open: true, closeCode: code }));
    ws.on("error", () => settle({ open: false, closeCode: null }));
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

// 3) FLOOD de N handshakes (une même IP) → au-delà du plafond, close 1013.
const results = [];
for (let i = 0; i < N; i += 1) results.push(await handshake());
const rejected1013 = results.filter((r) => r.closeCode === 1013).length;
const normalClose = results.filter(
  (r) => r.closeCode !== null && r.closeCode !== 1013,
).length;

// 4) Assertions.
ok(
  rejected1013 >= 1,
  `≥ 1 handshake WS rejeté par le rate-limit IP (close 1013) — obtenu ${rejected1013}`,
);

// 5) Rapport.
console.log(`\nFlood ${N} handshakes WS depuis une même IP :`);
console.log(`  rejetés (close 1013 « Try Again Later ») : ${rejected1013}`);
console.log(`  fermés normalement (sous le plafond)     : ${normalClose}`);

if (fails.length) {
  console.error(`\n✗ ÉCHEC (${fails.length}) :`);
  fails.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}
console.log(
  "\n✓ Handshake WS e2e — le rate-limit IP couvre l'upgrade (compteur partagé HTTP+WS + close 1013).",
);
