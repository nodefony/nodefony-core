/**
 * Charge soutenue cross-pod, par paliers de connexions.
 *
 * Publie en continu sur le pod émetteur ; les clients sont branchés sur le pod
 * récepteur. Tout traverse : sceau HMAC → Redis → ingress du récepteur →
 * fan-out → WebSocket. Un troisième pod (le core) est sur le même bus et
 * REFUSE ces canaux : son compteur de rejets mesure le coût de la défense.
 *
 *   node soak.mjs <portRx> <portTx> <paliers> <secondesParPalier>
 *   ex. node soak.mjs 5172 5171 50,200,500 30
 */
const [portRx = "5172", portTx = "5171", steps = "50,200,500", hold = "30"] =
  process.argv.slice(2);
const PALIERS = steps.split(",").map(Number);
const HOLD_MS = Number(hold) * 1000;

const sockets = [];
let received = 0;
let latSum = 0;
let latMax = 0;
const latSamples = [];

function open(port) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/chat/realtime`);
    ws.addEventListener("message", (ev) => {
      const f = JSON.parse(String(ev.data));
      if (f.method === "realtime:welcome") {
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
      if (f.method === "chat:room1") {
        received += 1;
        const l = Date.now() - f.params.ts;
        latSum += l;
        if (l > latMax) latMax = l;
        if (latSamples.length < 20000) latSamples.push(l);
      }
    });
    ws.addEventListener("error", () => resolve(null));
  });
}

const probe = async (port) =>
  (await fetch(`http://127.0.0.1:${port}/api/chat/probe`)).json();

for (const cible of PALIERS) {
  while (sockets.length < cible) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(50, cible - sockets.length) }, () =>
        open(portRx),
      ),
    );
    sockets.push(...batch.filter(Boolean));
  }
  await new Promise((r) => setTimeout(r, 800));

  received = 0;
  latSum = 0;
  latMax = 0;
  latSamples.length = 0;
  const avant = await probe(portTx);
  const t0 = Date.now();
  let publiés = 0;
  // Rafales enchaînées sans pause : on pousse le bus autant que l'émetteur suit.
  while (Date.now() - t0 < HOLD_MS) {
    const r = await (
      await fetch(`http://127.0.0.1:${portTx}/api/chat/burst`)
    ).json();
    publiés += r.published;
  }
  const durée = (Date.now() - t0) / 1000;
  await new Promise((r) => setTimeout(r, 2000)); // drain
  const après = await probe(portTx);
  const rx = await probe(portRx);

  latSamples.sort((a, b) => a - b);
  const pct = (p) =>
    latSamples[Math.floor((latSamples.length * p) / 100)] ?? -1;
  console.log(
    JSON.stringify({
      connexions: sockets.length,
      duréeS: +durée.toFixed(1),
      publiésParSec: Math.round(publiés / durée),
      livraisonsParSec: Math.round(received / durée),
      livraisonsAttendues: publiés * sockets.length,
      livraisonsReçues: received,
      pertePct: +(
        ((publiés * sockets.length - received) / (publiés * sockets.length)) *
        100
      ).toFixed(2),
      latenceMs: { p50: pct(50), p95: pct(95), p99: pct(99), max: latMax },
      fanoutPodTx: après.fanoutTotal - avant.fanoutTotal,
      ingressRejetésRx: rx.ingressRejectedTotal,
    }),
  );
}

for (const s of sockets) s.close();
process.exit(0);
