/**
 * Latence PURE du chemin cross-pod, hors saturation : 1 client, messages
 * espacés (aucun backlog). Mesure : publish A1 → sceau → Redis → ingress A2 →
 * fan-out → frame WS.
 *   node latency.mjs <portRx> <portTx> <nbMessages> <intervalleMs>
 */
const [portRx = "5172", portTx = "5171", n = "60", gap = "50"] =
  process.argv.slice(2);
const lat = [];
const ws = new WebSocket(`ws://127.0.0.1:${portRx}/api/chat/realtime`);
await new Promise((resolve) => {
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
      setTimeout(resolve, 300);
    }
    if (f.method === "chat:room1") lat.push(Date.now() - f.params.ts);
  });
});
for (let i = 0; i < Number(n); i++) {
  await fetch(`http://127.0.0.1:${portTx}/api/chat/say`, { method: "POST" });
  await new Promise((r) => setTimeout(r, Number(gap)));
}
await new Promise((r) => setTimeout(r, 1000));
lat.sort((a, b) => a - b);
const pct = (p) => lat[Math.floor((lat.length * p) / 100)] ?? -1;
console.log(
  JSON.stringify({
    reçus: lat.length,
    latenceMs: { min: lat[0], p50: pct(50), p95: pct(95), max: lat.at(-1) },
  }),
);
process.exit(0);
