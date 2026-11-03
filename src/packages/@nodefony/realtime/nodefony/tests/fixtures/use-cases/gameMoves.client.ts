import { NodefonySocket } from "nodefony/client";

const socket = NodefonySocket.shared({
  url: "/api/arena/realtime",
  maxBufferedAmount: 64 * 1024, // au-delà, la commande est JETÉE et comptée, pas mise en file
});

/** Chaque état reçu REMPLACE le précédent : rien n'est empilé. */
export function watchArena(draw: (players: unknown) => void): () => void {
  const off = socket.on("game:state", draw); // les positions viennent du SERVEUR
  socket.subscribe("game:state"); // le premier abonné démarre le moteur du jeu
  return () => {
    off();
    socket.unsubscribe("game:state");
  };
}

/** La manette, lue soixante fois par seconde : une direction, aucune réponse attendue. */
export function steer(dx: number, dy: number): void {
  socket.emit("game:steer", { dx, dy });
}
