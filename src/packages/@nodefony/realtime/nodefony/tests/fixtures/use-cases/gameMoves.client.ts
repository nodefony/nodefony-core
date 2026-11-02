import { NodefonySocket } from "nodefony/client";

const socket = NodefonySocket.shared({
  url: "/api/live/realtime",
  maxBufferedAmount: 64 * 1024, // au-delà, le coup est JETÉ et compté, pas mis en file
});

/** Chaque état reçu REMPLACE le précédent : rien n'est empilé. */
export function watchArena(draw: (players: unknown) => void): () => void {
  const off = socket.on("game:state", draw); // charge réseau : la vérifier avant de dessiner
  socket.subscribe("game:state");
  return () => {
    off();
    socket.unsubscribe("game:state");
  };
}

/** Soixante fois par seconde : une notification, aucune réponse attendue. */
export function move(x: number, y: number): void {
  socket.emit("game:move", { x, y });
}
