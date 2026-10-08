// Charge de la SOCKET Nodefony côté HUB (RealtimeHub) — fait bouger le panneau
// « Realtime Hub » de Studio (/nodefony/hub) + l'endpoint /nodefony/realtime/api/health.
//
// ⚠️ Cible la socket STUDIO `/nodefony/studio/api/realtime` (JSON-RPC pub/sub) : c'est
// elle qui passe par le RealtimeHub. Les routes WS du module test (ws/echo, ws/broadcast)
// BYPASSENT le hub → elles ne bougent PAS la sonde (canal nodefony:socket).
//
// Deux modes :
//   MODE=fanout (défaut) — N abonnés SAINS (drainent) à un canal qui tique
//       → connexions/abonnés/DIFFUSION (fan-out)/débit montent ; backpressure reste 0.
//   MODE=slow            — N consommateurs LENTS : s'abonnent puis ARRÊTENT de lire
//       (socket.pause()). Couplé à un flot de logs (HTTP_RPS → canal nodefony:syslog),
//       la file d'envoi du serveur (ws.bufferedAmount) se remplit pour eux
//       → backpressure grimpe (jauge jaune/rouge), slowConsumers ↑.
//
// La socket Studio et la sonde de santé sont dans la zone d'administration : le
// banc se connecte d'abord (compte de développement, surchargé par
// NF_BENCH_ADMIN_USER / NF_BENCH_ADMIN_PASSWORD) et porte le cookie sur chaque
// socket et chaque relevé. Sans lui, la socket est fermée en 1008 et la sonde
// rend 401 — le banc affichait alors `conn=undefined subs=0` sans échouer.
//
// Validité (règle n°1 du skill) : sortie 1 si une socket n'ouvre pas, est fermée
// par le serveur, reçoit un refus d'abonnement, si la sonde ne répond pas 200, ou
// (fanout) si un abonné n'a reçu AUCUNE frame du canal pendant le maintien.
//
// Prérequis : serveur dev UP. Lancé via run.sh (résout `ws` + la racine repo).
//   bash .claude/skills/nodefony-load-test/scripts/run.sh hub
//   MODE=slow run.sh hub
//   N=400 CH=nodefony:supervision:250 run.sh hub
import WebSocket from "ws";
import { PLATFORM_CHANNELS } from "nodefony";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // loopback auto-signé (load script)

const HOST = process.env.HOST || "127.0.0.1";
const PORT = process.env.PORT || "5152";
const BASE = `https://${HOST}:${PORT}`;
const WS_URL =
  process.env.WS_URL || `wss://${HOST}:${PORT}/nodefony/studio/api/realtime`;
const HEALTH = `${BASE}/nodefony/realtime/api/health`;
const LOGIN = `${BASE}/nodefony/security/api/auth/login`;
const ADMIN_USER = process.env.NF_BENCH_ADMIN_USER || "admin";
const ADMIN_PASSWORD =
  process.env.NF_BENCH_ADMIN_PASSWORD || "secret-de-dev-42";

const MODE = process.env.MODE || "fanout"; // fanout | slow
const N = Number(process.env.N || (MODE === "slow" ? 150 : 250));
const BATCH = Number(process.env.BATCH || 40);
const HOLD = Number(process.env.HOLD_MS || 60000);
// Noms lus au registre des canaux de plateforme, jamais recopiés : le banc
// visait `dashboard:supervision:500` des mois après le renommage, et le serveur
// répondait « aucun producteur » à chaque abonné.
const CH =
  process.env.CH ||
  (MODE === "slow"
    ? PLATFORM_CHANNELS.syslog
    : `${PLATFORM_CHANNELS.supervision}:500`);
// Flot HTTP → génère des logs (canal nodefony:syslog) = volume pour saturer vite les
// files des consommateurs lents (sinon les buffers TCP loopback sont longs à remplir).
const HTTP_RPS = Number(process.env.HTTP_RPS || (MODE === "slow" ? 300 : 0));
const HTTP_PATH = process.env.HTTP_PATH || "/nodefony/test/index";

const socks = [];
// Relevés de validité — chaque écart rend le run invalide.
const received = [];
let serverClosed = 0;
let denied = 0;
let probeFailures = 0;
let cookie = "";

/** Ouvre une session d'administration et rend son cookie. */
async function login() {
  const res = await fetch(LOGIN, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASSWORD }),
  });
  if (!res.ok) {
    console.error(
      `✖ connexion ${ADMIN_USER} refusée (HTTP ${res.status}) — rien mesuré`,
    );
    process.exit(1);
  }
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

function connect() {
  return new Promise((res) => {
    const index = socks.length;
    received.push(0);
    const ws = new WebSocket(WS_URL, {
      rejectUnauthorized: false,
      headers: { Cookie: cookie },
    });
    ws.on("close", (code) => {
      // 1000/1005 : fermeture demandée par le banc lui-même.
      if (code !== 1000 && code !== 1005) serverClosed++;
    });
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
        // consommateur SAIN : draine, et compte ce qu'il reçoit du canal
        ws.on("message", (raw) => {
          // `ws` 7 (résolu depuis la racine) livre une trame texte en chaîne,
          // `ws` 8 en Buffer : les deux formes comptent.
          const text =
            typeof raw === "string"
              ? raw
              : Buffer.isBuffer(raw)
                ? raw.toString("utf8")
                : "";
          if (text.includes('"realtime:denied"')) denied++;
          else if (text.includes(`"method":"${CH}"`)) received[index]++;
        });
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
  // oxlint-disable-next-line no-unmodified-loop-condition -- `httpOn` est basculé après la phase de maintien, depuis un autre contexte asynchrone : la règle ne suit pas cette écriture
  while (httpOn) {
    fetch(`${BASE}${HTTP_PATH}`).catch(() => {});
    await new Promise((r) => setTimeout(r, periodMs));
  }
}

async function poll() {
  try {
    const res = await fetch(HEALTH, { headers: { Cookie: cookie } });
    if (!res.ok) {
      probeFailures++;
      console.log(`sonde santé : HTTP ${res.status}`);
      return;
    }
    const h = await res.json();
    const subs = (h.channels || []).reduce((a, c) => a + c.subscribers, 0);
    const bp = h.backpressure || {};
    const kib = (n) => `${(Number(n || 0) / 1024).toFixed(1)}Ko`;
    console.log(
      `conn=${h.connectionCount} subs=${subs} fanoutTotal=${h.fanoutTotal} ` +
        `bp.max=${kib(bp.maxBufferedAmount)} bp.total=${kib(bp.totalBufferedAmount)} slow=${bp.slowConsumers}`,
    );
  } catch (e) {
    probeFailures++;
    console.log("poll err:", e.message);
  }
}

// Un rejet reste non géré (sortie en erreur de Node), comme avant : rien à rattraper ici.
void (async () => {
  console.log(
    `MODE=${MODE} N=${N} CH=${CH} HTTP_RPS=${HTTP_RPS} HOLD=${HOLD}ms`,
  );
  cookie = await login();
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
  // Lâché exprès : tourne jusqu'à `httpOn = false`, chaque `fetch` a son `.catch`.
  void httpBlaster();
  // `poll` rattrape ses propres erreurs : la promesse lâchée ne peut pas rejeter.
  const pid = setInterval(() => void poll(), 2000);
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
  const silent = MODE === "fanout" ? received.filter((n) => n === 0).length : 0;
  const total = received.reduce((a, n) => a + n, 0);
  const invalid =
    ok < N || serverClosed > 0 || denied > 0 || probeFailures > 0 || silent > 0;
  console.log(
    `${invalid ? "✖ INVALIDE" : "✓ valide"} — ouvertes ${ok}/${N}, fermées par le serveur ${serverClosed}, ` +
      `refus ${denied}, sondes en échec ${probeFailures}` +
      (MODE === "fanout"
        ? `, frames reçues ${total} (abonnés muets ${silent})`
        : ""),
  );
  setTimeout(() => process.exit(invalid ? 1 : 0), 1000);
})();
