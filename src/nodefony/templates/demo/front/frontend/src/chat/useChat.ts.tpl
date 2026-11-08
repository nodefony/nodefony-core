import { useCallback, useEffect, useRef, useState } from "react";
import { NodefonySocket } from "nodefony/client";
import type { RealtimeIdentity, RealtimeState } from "nodefony/client";
import {
  CHAT_REALTIME_PATH,
  ROOM_CHANNEL,
  TYPING_CHANNEL,
  type ChatContract,
  type ChatMessage,
} from "./chatContract";

/** Messages rechargés à l'ouverture et à chaque reconnexion. */
const HISTORY_SIZE = 50;

/** Un signal de frappe au plus toutes les deux secondes. */
const TYPING_THROTTLE_MS = 2000;

/** « Untel écrit… » s'efface sans nouveau signal. */
const TYPING_DISPLAY_MS = 3000;

/** Ce que l'écran du salon lit et fait. */
export interface IChatRoom {
  messages: ChatMessage[];
  /** Qui écrit en ce moment (un autre que soi), ou `null`. */
  typing: string | null;
  /** L'identité annoncée par le serveur ; `null` avant l'accueil. */
  identity: RealtimeIdentity | null;
  state: RealtimeState;
  /** Envoie un message ; rejette avec le motif du serveur (401, 422…). */
  send(text: string): Promise<void>;
  /** Signale qu'on écrit (borné : au plus un signal par intervalle). */
  notifyTyping(): void;
}

/** Clé d'un message — l'historique et le salon peuvent livrer le même. */
function keyOf(message: ChatMessage): string {
  return `${message.sentAt}|${message.author}|${message.text}`;
}

/** Fusionne sans doublon, dans l'ordre d'envoi. */
function merge(known: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const seen = new Set(known.map(keyOf));
  const added = incoming.filter((message) => !seen.has(keyOf(message)));
  if (added.length === 0) return known;
  return [...known, ...added].sort((a, b) => a.sentAt - b.sentAt);
}

/**
 * Le salon du chat, par la socket typée du contrat.
 *
 * Guide pour un agent : `NodefonySocket.fromContract<ChatContract>()` type
 * tout ce que la page touche — `get`/`post` par les routes du contrat (corps
 * et query vérifiés à la compilation), `on`/`emit` par ses canaux. LIRE ne
 * demande rien ; ÉCRIRE passe par `post` (une ACTION du serveur, gardée par
 * `@IsGranted`) — l'auteur n'est jamais envoyé. À la reconnexion, l'historique
 * est relu : les messages manqués pendant la coupure reviennent. Hooks prêts à
 * l'emploi pour un `<NodefonyProvider>` : `nodefony/react` (doc
 * `nodefony/docs/react-hooks.md`).
 */
export function useChat(): IChatRoom {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [typing, setTyping] = useState<string | null>(null);
  const [identity, setIdentity] = useState<RealtimeIdentity | null>(null);
  const [state, setState] = useState<RealtimeState>("disconnected");
  const socketRef = useRef<ReturnType<
    typeof NodefonySocket.fromContract<ChatContract>
  > | null>(null);
  const lastTyping = useRef(0);

  useEffect(() => {
    const socket = NodefonySocket.fromContract<ChatContract>({
      url: CHAT_REALTIME_PATH,
    });
    socketRef.current = socket;
    let typingTimer: ReturnType<typeof setTimeout> | null = null;
    // #region chat-history-client
    // Relu à chaque connexion : les messages manqués pendant une coupure reviennent.
    const loadHistory = () => {
      socket
        .get("/demo/chat/history", { query: { limit: HISTORY_SIZE } })
        .then((past) => setMessages((known) => merge(known, past)))
        .catch(() => {
          // Coupure entre-temps : la reconnexion relira l'historique.
        });
    };
    // #endregion
    const offs = [
      // #region chat-room-client
      // Chaque message publié sur le salon arrive ici, typé par le contrat.
      socket.on(ROOM_CHANNEL, (message) =>
        setMessages((known) => merge(known, [message])),
      ),
      // #endregion
      socket.on(TYPING_CHANNEL, ({ author }) => {
        if (author === socket.identity?.userIdentifier) return;
        setTyping(author);
        if (typingTimer !== null) clearTimeout(typingTimer);
        typingTimer = setTimeout(() => setTyping(null), TYPING_DISPLAY_MS);
      }),
      socket.onIdentity(setIdentity),
      socket.onState((next) => {
        setState(next);
        if (next === "connected") loadHistory();
      }),
    ];
    socket.subscribe(ROOM_CHANNEL);
    socket.subscribe(TYPING_CHANNEL);
    socket.connect().catch(() => {
      // Serveur injoignable : l'état le dit, la reconnexion continue en fond.
    });
    return () => {
      for (const off of offs) off();
      if (typingTimer !== null) clearTimeout(typingTimer);
      socket.unsubscribe(ROOM_CHANNEL);
      socket.unsubscribe(TYPING_CHANNEL);
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  // #region chat-send-client
  // Le texte seul : l'auteur, c'est le serveur qui le pose d'après la session.
  const send = useCallback(async (text: string) => {
    const socket = socketRef.current;
    if (socket === null) throw new Error("socket fermée");
    await socket.post("/demo/chat/send", { text });
  }, []);
  // #endregion

  // #region chat-typing-client
  // Un signal SANS champ, au plus toutes les deux secondes.
  const notifyTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTyping.current < TYPING_THROTTLE_MS) return;
    lastTyping.current = now;
    socketRef.current?.emit(TYPING_CHANNEL, {});
  }, []);
  // #endregion

  return { messages, typing, identity, state, send, notifyTyping };
}
