import { useCallback, useEffect, useRef, useState } from "react";
import { EMPTY_PRESENCE, NodefonySocket } from "nodefony/client";
import type {
  IPresenceSnapshot,
  RealtimeIdentity,
  RealtimeState,
} from "nodefony/client";
import {
  CHAT_ATTACH_PATH,
  CHAT_REALTIME_PATH,
  isRoomFrame,
  type ChatContract,
  type ChatMessage,
} from "./chatContract";
import { LOBBY_ROOM_ID, roomChannel, type IRoomView } from "./rooms";
import { RosterTracker, type IRosterRow } from "./roster";

/** Messages rechargés à l'ouverture d'un salon et à chaque reconnexion. */
const HISTORY_SIZE = 50;

/** Un signal de frappe au plus toutes les deux secondes. */
const TYPING_THROTTLE_MS = 2000;

/** « Untel écrit… » s'efface sans nouveau signal. */
const TYPING_DISPLAY_MS = 3000;

/** La socket typée par le contrat du chat. */
type ChatSocket = ReturnType<typeof NodefonySocket.fromContract<ChatContract>>;

/** Ce que l'écran du chat lit et fait. */
export interface IChatRoom {
  /** Les salons visibles : publics, les miens, ceux où l'on m'invite. */
  rooms: IRoomView[];
  /** Le salon ouvert. */
  roomId: string;
  /** Ouvre un autre salon. */
  openRoom: (roomId: string) => void;
  messages: ChatMessage[];
  /** Qui écrit dans le salon ouvert, soi compris : la même fenêtre pour tous. */
  typing: string | null;
  /** La présence du salon ouvert (ADR-0025). */
  presence: IPresenceSnapshot;
  /** Les lignes du panneau des présents, triées. */
  people: IRosterRow[];
  /** Pourquoi le salon ouvert est fermé à cette page ; `null` s'il est ouvert. */
  refusal: string | null;
  /** L'identité annoncée par le serveur ; `null` avant l'accueil. */
  identity: RealtimeIdentity | null;
  state: RealtimeState;
  /**
   * Envoie un message au salon ouvert, avec ses pièces s'il en a ; rejette
   * avec le motif du serveur (403, 413, 422…). Rien ne s'affiche avant
   * l'annonce du salon.
   */
  send: (text: string, files?: readonly File[]) => Promise<void>;
  /** Signale qu'on écrit (borné : au plus un signal par intervalle). */
  notifyTyping: () => void;
}

/** Le motif d'un refus HTTP : le message du serveur, sinon le statut. */
async function refusalOf(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  if (typeof body === "object" && body !== null) {
    for (const key of ["message", "error"]) {
      const value: unknown = Reflect.get(body, key);
      if (typeof value === "string" && value !== "") return value;
    }
  }
  return `envoi refusé (${response.status})`;
}

/**
 * Fusionne sans doublon, dans l'ordre d'envoi. L'historique et le salon
 * peuvent livrer le même message : son `id` stable (XEP-0359) le dit.
 */
function merge(known: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const seen = new Set(known.map((message) => message.id));
  const added = incoming.filter((message) => !seen.has(message.id));
  if (added.length === 0) return known;
  return [...known, ...added].toSorted((a, b) => a.sentAt - b.sentAt);
}

/** Ce que la page dit d'un refus du serveur. */
const REFUSALS: Record<string, string> = {
  forbidden:
    "Ce salon est réservé à ses membres et aux invités d'un événement en cours.",
  evicted: "Vous n'êtes plus membre de ce salon.",
  unauthorized: "Connectez-vous pour entrer dans ce salon.",
  unavailable: "Le serveur n'a pas pu vérifier vos droits : réessayez.",
};

/**
 * Le chat, par la socket typée du contrat : la liste des salons, et le salon
 * ouvert — ses messages, sa frappe, sa présence.
 *
 * Guide pour un agent : UNE socket pour tous les salons ; ouvrir un salon,
 * c'est s'abonner à SON canal (`chat:room:<id>`) et se désabonner du
 * précédent — la présence suit l'abonnement. Tout est POUSSÉ : la liste des
 * salons se relit quand le canal personnel le dit (`onUser`), un retrait
 * arrive en `realtime:closed` (`evicted`), un refus en `realtime:denied`. À
 * la reconnexion, l'historique du salon est relu et l'abonnement rejoué par
 * la socket. Doc : `@nodefony/realtime/docs/canaux-a-membres.md`.
 */
export function useChat(): IChatRoom {
  const [rooms, setRooms] = useState<IRoomView[]>([]);
  const [roomId, setRoomId] = useState(LOBBY_ROOM_ID);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [typing, setTyping] = useState<string | null>(null);
  const [presence, setPresence] = useState<IPresenceSnapshot>(EMPTY_PRESENCE);
  const [people, setPeople] = useState<IRosterRow[]>([]);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [identity, setIdentity] = useState<RealtimeIdentity | null>(null);
  const [state, setState] = useState<RealtimeState>("disconnected");
  const [socket, setSocket] = useState<ChatSocket | null>(null);
  const lastTyping = useRef(0);

  // La socket et la liste des salons : une fois pour la page.
  useEffect(() => {
    const created = NodefonySocket.fromContract<ChatContract>({
      url: CHAT_REALTIME_PATH,
    });
    setSocket(created);
    const loadRooms = () => {
      created
        .get("/demo/chat/rooms")
        .then(setRooms)
        .catch(() => {
          // Coupure entre-temps : la reconnexion relira la liste.
        });
    };
    const offs = [
      created.onIdentity(setIdentity),
      created.onState((next) => {
        setState(next);
        if (next === "connected") loadRooms();
      }),
      // #region chat-rooms-client
      // Ajouté à un salon, retiré, invité : le serveur le POUSSE, on relit.
      created.onUser(() => loadRooms()),
      // #endregion
    ];
    created.connect().catch(() => {
      // Serveur injoignable : l'état le dit, la reconnexion continue en fond.
    });
    return () => {
      for (const off of offs) off();
      created.disconnect();
      setSocket(null);
    };
  }, []);

  // Le salon ouvert : son canal, son historique, sa frappe, sa présence.
  useEffect(() => {
    if (socket === null) return;
    const channel = roomChannel(roomId);
    const roster = new RosterTracker();
    let typingTimer: ReturnType<typeof setTimeout> | null = null;
    let markTimer: ReturnType<typeof setTimeout> | null = null;
    // Qui regarde : connu si la socket a déjà reçu son accueil.
    let me: string | null =
      socket.identity?.authenticated === true ? socket.identity.id : null;
    let live = true;
    setMessages([]);
    setTyping(null);
    setRefusal(null);
    setPresence(EMPTY_PRESENCE);
    setPeople([]);

    /** Rend le panneau, et se rappelle à l'échéance de la prochaine marque. */
    const draw = () => {
      if (!live) return;
      const now = Date.now();
      setPeople(roster.rows(me, now));
      if (markTimer !== null) clearTimeout(markTimer);
      const next = roster.nextChange(now);
      markTimer = next === null ? null : setTimeout(draw, next + 16);
    };
    /** Demande les noms encore inconnus — seuls les présents sont nommés. */
    const askNames = () => {
      const ids = roster.missingNames();
      if (ids.length === 0) return;
      socket
        .get("/demo/chat/rooms/{room}/people", {
          params: { room: roomId },
          query: { ids: ids.join(",") },
        })
        .then((found) => {
          roster.learn(ids, found);
          draw();
        })
        .catch(() => roster.forget(ids));
    };
    // #region chat-history-client
    // Relu à chaque connexion : les messages manqués pendant une coupure reviennent.
    const loadHistory = () => {
      socket
        .get("/demo/chat/rooms/{room}/history", {
          params: { room: roomId },
          query: { limit: HISTORY_SIZE },
        })
        .then((past) => {
          if (live) setMessages((known) => merge(known, past));
        })
        .catch(() => {
          // Refus ou coupure : le refus du canal le dira.
        });
    };
    // #endregion
    const offs = [
      // #region chat-room-client
      // Le canal du salon porte ses messages ET sa frappe, typés par le contrat.
      socket.on(channel, (frame) => {
        if (!isRoomFrame(frame)) return;
        if (frame.kind === "message") {
          setMessages((known) => merge(known, [frame.message]));
          return;
        }
        setTyping(frame.author);
        if (typingTimer !== null) clearTimeout(typingTimer);
        typingTimer = setTimeout(() => setTyping(null), TYPING_DISPLAY_MS);
      }),
      // #endregion
      // #region chat-presence-client
      // Qui est là : la vue du salon, puis les noms demandés à l'annuaire.
      socket.onPresence(channel, (snapshot) => {
        setPresence(snapshot);
        roster.observe(snapshot.members, snapshot.partial, Date.now());
        draw();
        askNames();
      }),
      // #endregion
      socket.onIdentity((who) => {
        me = who?.authenticated === true ? who.id : null;
        draw();
      }),
      socket.onDenied((denied) => {
        if (denied.channel === channel)
          setRefusal(REFUSALS[denied.reason] ?? "Ce salon vous est fermé.");
      }),
      socket.onClosed((closed) => {
        if (closed.channel === channel)
          setRefusal(REFUSALS[closed.reason] ?? "Ce salon s'est fermé.");
      }),
      socket.onState((next) => {
        if (next === "connected") loadHistory();
      }),
    ];
    socket.subscribe(channel);
    if (socket.state === "connected") loadHistory();
    return () => {
      live = false;
      for (const off of offs) off();
      if (typingTimer !== null) clearTimeout(typingTimer);
      if (markTimer !== null) clearTimeout(markTimer);
      socket.unsubscribe(channel);
    };
  }, [socket, roomId]);

  const send = useCallback(
    async (text: string, files: readonly File[] = []) => {
      if (files.length > 0) return sendWithFiles(roomId, text, files);
      // #region chat-send-client
      // Le texte seul : l'auteur, c'est le serveur qui le pose d'après la session.
      if (socket === null) throw new Error("socket fermée");
      await socket.post(
        "/demo/chat/rooms/{room}/send",
        { text },
        { params: { room: roomId } },
      );
      // #endregion
    },
    [socket, roomId],
  );

  // #region chat-typing-client
  // Un signal SANS corps, au plus toutes les deux secondes : l'auteur vient
  // de la connexion, et le signal ne quitte pas le salon.
  const notifyTyping = useCallback(() => {
    const now = Date.now();
    if (socket === null || now - lastTyping.current < TYPING_THROTTLE_MS)
      return;
    lastTyping.current = now;
    socket
      .post("/demo/chat/rooms/{room}/typing", undefined, {
        params: { room: roomId },
      })
      .catch(() => {
        // Un signal perdu ne se rattrape pas : le prochain le remplace.
      });
  }, [socket, roomId]);
  // #endregion

  return {
    rooms,
    roomId,
    openRoom: setRoomId,
    messages,
    typing,
    presence,
    people,
    refusal,
    identity,
    state,
    send,
    notifyTyping,
  };
}

// #region chat-attach-client
/**
 * Un message AVEC pièces : un `POST` multipart ordinaire, la session suit par
 * le cookie. La clé d'idempotence est tirée par INTENTION d'envoi. Et rien
 * d'autre : le message reviendra par le salon, comme chez tout le monde — un
 * seul chemin met l'écran à jour.
 */
async function sendWithFiles(
  roomId: string,
  text: string,
  files: readonly File[],
): Promise<void> {
  const form = new FormData();
  form.append("text", text);
  for (const file of files) form.append("file", file, file.name);
  const response = await fetch(
    CHAT_ATTACH_PATH.replace("{room}", encodeURIComponent(roomId)),
    {
      method: "POST",
      body: form,
      credentials: "same-origin",
      headers: { "Idempotency-Key": crypto.randomUUID() },
    },
  );
  if (!response.ok) throw new Error(await refusalOf(response));
}
// #endregion
