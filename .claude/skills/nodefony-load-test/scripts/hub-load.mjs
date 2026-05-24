// Charge de la SOCKET Nodefony côté HUB (RealtimeHub) — fait bouger le panneau
// « Realtime Hub » de Studio (/nodefony/hub) + l'endpoint /nodefony/realtime/api/health.
//
// ⚠️ Cible la socket STUDIO `/nodefony/studio/api/realtime` (JSON-RPC pub/sub) : c'est
// elle qui passe par le RealtimeHub. Les routes WS du module test (ws/echo, ws/broadcast)
// BYPASSENT le hub → elles ne bougent PAS realtime:health.
//
// Deux modes :
//   MODE=fanout (défaut) — N abonnés SAINS (drainent) à un canal qui tique
//       → connexions/abonnés/DIFFUSION (fan-out)/débit montent ; backpressure reste 0.
//   MODE=slow            — N consommateurs LENTS : s'abonnent puis ARRÊTENT de lire
//       (socket.pause()). Couplé à un flot de logs (HTTP_RPS → canal syslog:stream),
//       la file d'envoi du serveur (ws.bufferedAmount) se remplit pour eux
//       → backpressure grimpe (jauge jaune/rouge), slowConsumers ↑.
//
// Prérequis : serveur dev UP. Lancé via run.sh (résout `ws` + la racine repo).
//   bash .claude/skills/nodefony-load-test/scripts/run.sh hub
//   MODE=slow run.sh hub
//   N=400 CH=dashboard:supervision:250 run.sh hub
import WebSocket from "ws";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // loopback auto-signé (load script)

const HOST = process.env.HOST || "127.0.0.1";
const PORT = process.env.PORT || "5152";
const BASE = `https://${HOST}:${PORT}`;
const WS_URL =
  process.env.WS_URL || `wss://${HOST}:${PORT}/nodefony/studio/api/realtime`;
const HEALTH = `${BASE}/nodefony/realtime/api/health`;

const MODE = process.env.MODE || "fanout"; // fanout | slow
const N = Number(process.env.N || (MODE === "slow" ? 150 : 250));
const BATCH = Number(process.env.BATCH || 40);
const HOLD = Number(process.env.HOLD_MS || 60000);
const CH =
  process.env.CH ||
  (MODE === "slow" ? "syslog:stream" : "dashboard:supervision:500");
// Flot HTTP → génère des logs (canal syslog:stream) = volume pour saturer vite les
// files des consommateurs lents (sinon les buffers TCP loopback sont longs à remplir).
const HTTP_RPS = Number(process.env.HTTP_RPS || (MODE === "slow" ? 300 : 0));
const HTTP_PATH = process.env.HTTP_PATH || "/nodefony/test/index";

const socks = [];

function connect() {
  return new Promise((res) => {
    const ws = new WebSocket(WS_URL, { rejectUnauthorized: false });
    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "subscribe",
          params: { channel: CH },
        }),
      );
      if (MODE === "slow") {
        // Consommateur LENT : on cesse de lire la socket → la file d'envoi du
        // serveur (ws.bufferedAmount) grossit pour cette connexion = backpressure.
        try {
          ws._socket.pause();
        } catch {
          /* selon la version de ws */
        }
      } else {
        ws.on("message", () => {}); // consommateur SAIN : draine
      }
      res(true);
    });
    ws.on("error", () => res(false));
    socks.push(ws);
  });
}

let httpOn = true;
async function httpBlaster() {
  if (HTTP_RPS <= 0) return;
  const periodMs = 1000 / HTTP_RPS;
  while (httpOn) {
    fetch(`${BASE}${HTTP_PATH}`).catch(() => {});
    await new Promise((r) => setTimeout(r, periodMs));
  }
}

async function poll() {
  try {
    const h = await (await fetch(HEALTH)).json();
    const subs = (h.channels || []).reduce((a, c) => a + c.subscribers, 0);
    const bp = h.backpressure || {};
    const kib = (n) => `${(Number(n || 0) / 1024).toFixed(1)}Ko`;
    console.log(
      `conn=${h.connectionCount} subs=${subs} fanoutTotal=${h.fanoutTotal} ` +
        `bp.max=${kib(bp.maxBufferedAmount)} bp.total=${kib(bp.totalBufferedAmount)} slow=${bp.slowConsumers}`,
    );
  } catch (e) {
    console.log("poll err:", e.message);
  }
}

(async () => {
  console.log(
    `MODE=${MODE} N=${N} CH=${CH} HTTP_RPS=${HTTP_RPS} HOLD=${HOLD}ms`,
  );
  let ok = 0;
  for (let b = 0; b < N; b += BATCH) {
    const r = await Promise.all(
      Array.from({ length: Math.min(BATCH, N - b) }, () => connect()),
    );
    ok += r.filter(Boolean).length;
    process.stdout.write(`open ${ok}/${N}\n`);
    await new Promise((r) => setTimeout(r, 150));
  }
  console.log(`${ok} abonnés sur ${CH}${MODE === "slow" ? " (LENTS)" : ""}`);
  httpBlaster();
  const pid = setInterval(poll, 2000);
  await new Promise((r) => setTimeout(r, HOLD));
  clearInterval(pid);
  httpOn = false;
  for (const ws of socks) {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  }
  console.log("closed all");
  setTimeout(() => process.exit(0), 1000);
})();
