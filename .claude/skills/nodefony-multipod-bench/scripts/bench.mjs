/**
 * Banc de charge F83 — latence de bout en bout d'un fan-out CROSS-POD.
 *
 * Chaîne mesurée : `publish` sur le pod émetteur → sceau HMAC → Redis pub/sub →
 * ingress du pod récepteur (admission par canal + vérification du sceau) →
 * fan-out local → frame WebSocket → client.
 *
 *   node bench.mjs <portRécepteur> <portÉmetteur> <connexions> <rafales>
 *
 * Chaque rafale publie 100 messages horodatés. Les deux pods tournent sur la
 * même machine → l'horloge est commune, la latence est directement lisible.
 */
const [portRx = "5172", portTx = "5171", conns = "50", bursts = "10"] =
  process.argv.slice(2);
const CONNS = Number(conns);
const BURSTS = Number(bursts);
const PER_BURST = 100;
const expected = BURSTS * PER_BURST * CONNS;

const latencies = [];
let received = 0;

/** Ouvre une connexion abonnée et résout quand elle est prête. */
function openClient() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${portRx}/api/chat/realtime`);
    ws.addEventListener("message", (ev) => {
      const frame = JSON.parse(String(ev.data));
      if (frame.method === "realtime:welcome") {
        ws.send(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "subscribe",
            params: { channel: "chat:room1" },
          }),
        );
        resolve(ws);
        return;
      }
      if (frame.method === "chat:room1") {
        received += 1;
        latencies.push(Date.now() - frame.params.ts);
      }
    });
    ws.addEventListener("error", reject);
  });
}

const sockets = await Promise.all(
  Array.from({ length: CONNS }, () => openClient()),
);
await new Promise((r) => setTimeout(r, 500)); // laisse les subscribe s'appliquer

const started = Date.now();
for (let i = 0; i < BURSTS; i++) {
  await fetch(`http://127.0.0.1:${portTx}/api/chat/burst`);
}
const publishMs = Date.now() - started;

await new Promise((r) => setTimeout(r, 3000)); // drain

latencies.sort((a, b) => a - b);
const pct = (p) =>
  latencies[
    Math.min(latencies.length - 1, Math.floor((latencies.length * p) / 100))
  ] ?? -1;
console.log(
  JSON.stringify({
    connexions: CONNS,
    messagesPubliés: BURSTS * PER_BURST,
    livraisonsAttendues: expected,
    livraisonsReçues: received,
    pertePct: +(((expected - received) / expected) * 100).toFixed(2),
    publishMs,
    latenceMs: {
      p50: pct(50),
      p95: pct(95),
      p99: pct(99),
      max: latencies.at(-1) ?? -1,
    },
    débitLivraisonsParSec: Math.round(received / ((publishMs || 1) / 1000)),
  }),
);
for (const s of sockets) s.close();
process.exit(0);
