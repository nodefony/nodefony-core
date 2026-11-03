import { NodefonySocket } from "nodefony/client";

const socket = NodefonySocket.shared({ url: "/api/board/realtime" });

/** Chaque écran s'abonne ; le serveur ne paie qu'un producteur pour tous. */
export function watchLoad(render: (load: unknown) => void): () => void {
  const off = socket.on("board:load", render); // charge réseau : la vérifier avant d'afficher
  socket.subscribe("board:load");
  return () => {
    off();
    socket.unsubscribe("board:load");
  };
}
