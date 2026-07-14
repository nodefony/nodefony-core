/**
 * Sonde : prouve que le job de scaffold est bien streamé sur la socket Nodefony.
 *
 * Enchaîne exactement ce que fera la page Studio :
 *   1. ouvre la socket JSON-RPC avec le cookie de session (le handshake WS n'accepte
 *      pas d'en-tête via l'API WebSocket standard → transport `ws` custom),
 *   2. appelle l'action `scaffold:run` (frame AVEC id → réponse attendue),
 *   3. s'abonne au canal `scaffold:job@<id>` APRÈS coup — volontairement en retard,
 *      pour vérifier que le backlog est rejoué et qu'aucune ligne n'est perdue,
 *   4. compte les lignes par nature et affiche le terminal.
 *
 * Usage : node scaffold-ws-probe.mjs <cookie> [type] [name]
 */
import WebSocket from "ws";

const cookie = process.argv[2];
const type = process.argv[3] ?? "controller";
const name = process.argv[4] ?? "StudioProbe";
if (!cookie) {
  console.error("usage: node scaffold-ws-probe.mjs <cookie-header> [type] [name]");
  process.exit(2);
}

const ws = new WebSocket("wss://127.0.0.1:5152/nodefony/studio/api/realtime", {
  headers: { Cookie: cookie },
  rejectUnauthorized: false,
});

let jobId = null;
const lines = [];
const counts = Object.create(null);
let subscribedAt = 0;

const send = (msg) => ws.send(JSON.stringify(msg));

ws.on("open", () => {
  console.log("socket ouverte → action scaffold:run");
  send({
    jsonrpc: "2.0",
    id: 1,
    method: "scaffold:run",
    params: {
      type,
      answers: { name, kind: "hello" },
      steps: [], // aucune étape npm : on veut isoler l'écriture + le stream
    },
  });
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());

  // Réponse à l'action : on récupère le job, PUIS on s'abonne (en retard, exprès).
  if (msg.id === 1) {
    if (msg.error) {
      console.error("scaffold:run a échoué:", msg.error);
      ws.close();
      return;
    }
    jobId = msg.result?.id;
    console.log(`job ${jobId} — status ${msg.result?.status}`);
    // Retard volontaire : les lignes d'écriture sont déjà parties quand on s'abonne.
    setTimeout(() => {
      subscribedAt = Date.now();
      console.log("→ subscribe (VOLONTAIREMENT en retard)");
      send({ jsonrpc: "2.0", method: "subscribe", params: { channel: `scaffold:job@${jobId}` } });
    }, 250);
    return;
  }

  // Lignes du canal.
  if (msg.method === "scaffold:job@" + jobId || msg.params?.channel?.startsWith?.("scaffold:job@")) {
    const line = msg.params?.data ?? msg.params?.payload ?? msg.params;
    if (line?.text) {
      lines.push(line);
      counts[line.stream] = (counts[line.stream] ?? 0) + 1;
    }
    return;
  }

  // Enveloppe alternative (selon la forme du provider).
  if (msg.params?.text) {
    lines.push(msg.params);
    counts[msg.params.stream] = (counts[msg.params.stream] ?? 0) + 1;
  }
});

ws.on("error", (e) => {
  console.error("erreur socket:", e.message);
  process.exit(1);
});

setTimeout(() => {
  console.log("\n──────── terminal reçu ────────");
  for (const l of lines) console.log(`[${l.stream}] ${l.text}`);
  console.log("───────────────────────────────");
  console.log("lignes par nature:", counts);
  console.log(`total: ${lines.length} ligne(s)`);
  const replayed = lines.filter((l) => l.ts < subscribedAt).length;
  console.log(
    `REJEU DU BACKLOG: ${replayed} ligne(s) produites AVANT l'abonnement et pourtant reçues`,
  );
  ws.close();
  process.exit(lines.length > 0 ? 0 : 1);
}, 4000);
