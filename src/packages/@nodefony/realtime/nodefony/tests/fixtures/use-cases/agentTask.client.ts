import { NodefonySocket } from "nodefony/client";

const socket = NodefonySocket.shared({ url: "/api/live/realtime" });

/** Démarre une tâche : le serveur nomme le canal, y abonne, puis le termine. */
export function startTask(
  onStep: (step: unknown) => void,
  onDone: () => void,
): void {
  socket.on("task:start", (reply) => {
    // Une charge reçue du réseau se vérifie avant usage.
    if (typeof reply !== "object" || reply === null || !("task" in reply))
      return;
    if (typeof reply.task === "string") socket.on(reply.task, onStep);
  });
  socket.onClosed(({ channel, reason }) => {
    if (channel.startsWith("task:") && reason === "ended") onDone();
  });
  socket.emit("task:start");
}
