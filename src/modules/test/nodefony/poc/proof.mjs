/**
 * POC « API souveraine » — Phase 1 — PREUVE (JETABLE).
 *
 * Prouve la thèse : la MÊME action `byAuthor`, écrite une fois, renvoie le MÊME
 * résultat qu'on l'atteigne par REST (GET) ou par WebSocket (pont invoke → resolveByPath).
 *
 * Usage (serveur dev UP) : node src/modules/test/nodefony/poc/proof.mjs
 * (WebSocket = global natif Node ≥ 22 — aucune dépendance.)
 */
const PATH = "/poc/books/by-author/42";
const REST_URL = `http://127.0.0.1:5151${PATH}`;
const WS_URL = "ws://127.0.0.1:5151/poc/invoke";

// 1) REST — la porte mûre
const restRes = await fetch(REST_URL);
const restJson = await restRes.json();
console.log("REST", restRes.status, JSON.stringify(restJson));

// 2) WS — le pont invoke re-route le MÊME path porté par le message
const wsResult = await new Promise((resolve, reject) => {
  const ws = new WebSocket(WS_URL);
  const timer = setTimeout(() => {
    ws.close();
    reject(new Error("timeout WS (5s)"));
  }, 5000);
  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({ id: 1, path: PATH }));
  });
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data); // event.data = string (frame texte)
    if (msg.handshake) return; // ignore le message de handshake
    clearTimeout(timer);
    ws.close();
    resolve(msg);
  });
  ws.addEventListener("error", (e) => {
    clearTimeout(timer);
    reject(new Error(`WS error: ${e.message ?? e}`));
  });
});
console.log("WS  ", JSON.stringify(wsResult));

// 3) Verdict — REST ≡ WS.result ?
const same = JSON.stringify(restJson) === JSON.stringify(wsResult.result);
console.log(
  same
    ? "✅ THÈSE PROUVÉE — REST ≡ WS (même action, 0 réécriture)"
    : "❌ DIVERGENCE — REST ≠ WS",
);
process.exit(same ? 0 : 1);
