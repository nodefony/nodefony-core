import { NodefonySocket } from "nodefony/client";

const ROOM = "chat:room";
const socket = NodefonySocket.shared({ url: "/chat/realtime" });

/** Qui est là : rappelé à chaque changement, la vue entière à chaque fois. */
export function watchPresence(render: (line: string) => void): () => void {
  const off = socket.onPresence(ROOM, (p) => {
    if (!p.ready) return; // « pas encore reçu » n'est pas « vide »
    const names = [...p.members.keys()].join(", ");
    const total = p.count + p.unnamed; // nommés (comptes) + connexions anonymes
    render(`${total} présent(s)${names === "" ? "" : ` : ${names}`}`);
  });
  socket.subscribe(ROOM);
  return () => {
    off();
    socket.unsubscribe(ROOM);
  };
}

/** Signaler qu'on écrit — au plus une fois toutes les deux secondes. */
export function typingNotifier(author: string): () => void {
  let last = 0;
  return () => {
    const now = Date.now();
    if (now - last < 2000) return;
    last = now;
    socket.emit("chat:typing", { author });
  };
}

/** « Untel écrit… » : affiché à réception, effacé seul trois secondes plus tard. */
export function watchTyping(
  self: string,
  show: (author: string | null) => void,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return socket.on(ROOM, (frame) => {
    if (typeof frame !== "object" || frame === null || !("typing" in frame))
      return;
    if (typeof frame.typing !== "string" || frame.typing === self) return;
    show(frame.typing);
    clearTimeout(timer);
    timer = setTimeout(() => show(null), 3000);
  });
}
