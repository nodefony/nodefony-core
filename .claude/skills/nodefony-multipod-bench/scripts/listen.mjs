/**
 * Écouteur du banc F83 — WebSocket brut parlant le JSON-RPC 2.0 de la socket
 * Nodefony. Se connecte au pod demandé, s'abonne à `chat:room1`, et rend en
 * JSON tout ce qui est arrivé pendant la fenêtre d'écoute.
 *
 *   node listen.mjs <port> <secondes>
 */
const port = process.argv[2] ?? "5172";
const seconds = Number(process.argv[3] ?? 6);
const received = [];
const frames = [];

const ws = new WebSocket(`ws://127.0.0.1:${port}/api/chat/realtime`);

ws.addEventListener("message", (ev) => {
  const frame = JSON.parse(String(ev.data));
  frames.push(frame.method ?? frame.id ?? "?");
  if (frame.method === "chat:room1") received.push(frame.params);
  // Le handshake serveur est asynchrone : toute frame poussée avant
  // `realtime:welcome` est droppée silencieusement.
  if (frame.method === "realtime:welcome") {
    ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "subscribe",
        params: { channel: "chat:room1" },
      }),
    );
  }
});

ws.addEventListener("error", (e) =>
  frames.push(`ERROR:${e.message ?? e.type}`),
);

await new Promise((r) => setTimeout(r, seconds * 1000));
console.log(JSON.stringify({ port, frames, received }));
process.exit(0);
