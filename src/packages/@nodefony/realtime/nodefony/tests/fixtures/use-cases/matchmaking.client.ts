import { NodefonySocket } from "nodefony/client";

const socket = NodefonySocket.shared({ url: "/api/match/realtime" });

/** Rien à écrire pour suivre la partie : le serveur IMPOSE l'abonnement. */
export function findMatch(onState: (state: unknown) => void): void {
  socket.onSubscribed(({ channel, imposed }) => {
    if (imposed === true && channel.startsWith("match:"))
      socket.on(channel, onState);
  });
  socket.emit("match:find");
}

socket.onClosed(({ channel, reason }) => {
  if (reason === "ended") console.log(`partie ${channel} terminée`);
});
