import { NodefonySocket } from "nodefony/client";

const socket = NodefonySocket.shared({ url: "/api/room/realtime" });

/** Entrer dans un salon : une DEMANDE, que `allow` tranche côté serveur. */
export function joinRoom(
  room: string,
  onMessage: (message: unknown) => void,
): () => void {
  const off = socket.on(room, onMessage);
  socket.subscribe(room);
  return () => {
    off();
    socket.unsubscribe(room);
  };
}

export function say(room: string, text: string): void {
  socket.emit("room:send", { room, text });
}

// Refusé (pas membre) ou exclu : l'écran le dit, et ne réessaie pas.
socket.onDenied(({ channel, reason }) =>
  console.warn(`${channel} : ${reason}`),
);
socket.onClosed(({ channel, reason }) => {
  if (reason === "evicted") console.warn(`exclu de ${channel}`);
});
