import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { z } from "zod";
import { EMPTY_PRESENCE, NodefonySocket } from "nodefony/client";
import type {
  IPresenceSnapshot,
  RealtimeIdentity,
  RealtimeState,
} from "nodefony/client";
import {
  CHAT_ATTACH_PATH,
  CHAT_REALTIME_PATH,
  nextTyping,
  type ChatContract,
  type ChatMessage,
} from "./chatContract";
import type { CreateRoomBody, EventBody, InviteBody } from "./chatSchemas";
import { mergeMessages, withReactions } from "./messages";
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
  send: (
    text: string,
    files?: readonly File[],
    replyTo?: string | null,
  ) => Promise<void>;
  /**
   * Les gestes sur un message du salon ouvert : chacun rejette avec le motif
   * du serveur. Rien ne change à l'écran avant que le salon ne l'annonce.
   */
  gestures: IMessageGestures;
  /** Signale qu'on écrit (borné : au plus un signal par intervalle). */
  notifyTyping: () => void;
  /**
   * Les gestes des formulaires : chacun rejette avec le message du serveur
   * (403, 404, 409, 422), que le formulaire affiche sous son champ.
   */
  forms: IRoomForms;
}

/** Modifier, retirer, réagir — une route du contrat chacun (XEP-0308, 0424, 0444). */
export interface IMessageGestures {
  /** Remplace le texte d'un de ses messages. */
  edit: (messageId: string, text: string) => Promise<void>;
  /** Retire un message — le sien, ou en modérateur. */
  retract: (messageId: string) => Promise<void>;
  /** Envoie l'ensemble ENTIER de ses réactions sur un message. */
  react: (messageId: string, emojis: readonly string[]) => Promise<void>;
}

/** Ce que le corps d'une route accepte EN ENTRÉE (avant ses défauts). */
type Draft<S extends z.ZodType> = z.input<S>;

/** Les gestes des formulaires du chat — une route du contrat chacun. */
export interface IRoomForms {
  /** Crée un salon, puis l'ouvre. */
  createRoom: (draft: Draft<typeof CreateRoomBody>) => Promise<void>;
  /** Invite une personne dans le salon ouvert. */
  invite: (draft: Draft<typeof InviteBody>) => Promise<void>;
  /** Planifie un événement dans le salon ouvert. */
  planEvent: (draft: Draft<typeof EventBody>) => Promise<void>;
  /** Accepte ou décline une invitation. */
  reply: (eventId: string, partstat: "accepted" | "declined") => Promise<void>;
  /** Ouvre le salon à deux avec une personne présente — ou le crée. */
  openDirect: (userId: string) => Promise<void>;
  /** Supprime le salon ouvert (son propriétaire seul), puis ouvre l'accueil. */
  deleteRoom: () => Promise<void>;
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

/** Ce que la page dit d'un refus du serveur. */
const REFUSALS: Record<string, string> = {
  forbidden:
    "Ce salon est réservé à ses membres et aux invités d'un événement en cours.",
  evicted: "Vous n'êtes plus membre de ce salon.",
  unauthorized: "Connectez-vous pour entrer dans ce salon.",
  unavailable: "Le serveur n'a pas pu vérifier vos droits : réessayez.",
  // `closeChannel` : le salon a été supprimé par son propriétaire.
  ended: "Ce salon a été supprimé.",
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
          if (live) setMessages((known) => mergeMessages(known, past));
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
        // Ni sa propre frappe, ni celle d'un auteur dont le message vient d'arriver.
        const self = socket.identity?.userIdentifier ?? null;
        setTyping((current) => nextTyping(current, frame, self));
        if (frame.kind === "message") {
          // Neuf, modifié ou retiré : la version reçue remplace la nôtre.
          setMessages((known) => mergeMessages(known, [frame.message]));
          return;
        }
        if (frame.kind === "reactions") {
          setMessages((known) =>
            withReactions(known, frame.messageId, frame.reactions),
          );
          return;
        }
        if (frame.author === self) return;
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
    async (
      text: string,
      files: readonly File[] = [],
      replyTo: string | null = null,
    ) => {
      if (files.length > 0) return sendWithFiles(roomId, text, files, replyTo);
      // #region chat-send-client
      // Le texte seul : l'auteur, c'est le serveur qui le pose d'après la session.
      if (socket === null) throw new Error("socket fermée");
      await socket.post(
        "/demo/chat/rooms/{room}/send",
        replyTo === null ? { text } : { text, replyTo },
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

  // #region rooms-forms-client
  // Un formulaire = une route du contrat, par la socket déjà ouverte. Un salon
  // créé ou ouvert à deux entre AUSSITÔT dans la liste ; le reste arrive par
  // le canal personnel (`onUser`), chez soi comme chez l'invité.
  const forms = useMemo<IRoomForms>(() => {
    const open = (room: IRoomView) => {
      setRooms((known) =>
        known.some((item) => item.id === room.id) ? known : [...known, room],
      );
      setRoomId(room.id);
    };
    const live = () => {
      if (socket === null) throw new Error("socket fermée");
      return socket;
    };
    return {
      createRoom: async (draft) =>
        open(await live().post("/demo/chat/rooms", draft)),
      invite: async (draft) => {
        await live().post("/demo/chat/rooms/{room}/members", draft, {
          params: { room: roomId },
        });
      },
      planEvent: async (draft) => {
        await live().post("/demo/chat/rooms/{room}/events", draft, {
          params: { room: roomId },
        });
      },
      reply: async (eventId, partstat) => {
        await live().post(
          "/demo/chat/events/{event}/reply",
          { partstat },
          { params: { event: eventId } },
        );
      },
      openDirect: async (userId) =>
        open(
          await live().post("/demo/chat/direct/{user}", undefined, {
            params: { user: userId },
          }),
        ),
      deleteRoom: async () => {
        const gone = roomId;
        await live().delete("/demo/chat/rooms/{room}", undefined, {
          params: { room: gone },
        });
        setRooms((known) => known.filter((item) => item.id !== gone));
        setRoomId(LOBBY_ROOM_ID);
      },
    };
  }, [socket, roomId]);
  // #endregion

  // #region chat-gestures-client
  // Modifier, retirer, réagir : une route chacun, par la socket déjà ouverte.
  // L'écran ne bouge qu'à l'annonce du salon — chez soi comme chez les autres.
  const gestures = useMemo<IMessageGestures>(() => {
    const live = () => {
      if (socket === null) throw new Error("socket fermée");
      return socket;
    };
    const params = (messageId: string) => ({
      params: { room: roomId, message: messageId },
    });
    return {
      edit: async (messageId, text) => {
        await live().patch(
          "/demo/chat/rooms/{room}/messages/{message}",
          { text },
          params(messageId),
        );
      },
      retract: async (messageId) => {
        await live().delete(
          "/demo/chat/rooms/{room}/messages/{message}",
          undefined,
          params(messageId),
        );
      },
      react: async (messageId, emojis) => {
        await live().put(
          "/demo/chat/rooms/{room}/messages/{message}/reactions",
          { emojis: [...emojis] },
          params(messageId),
        );
      },
    };
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
    gestures,
    notifyTyping,
    forms,
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
  replyTo: string | null,
): Promise<void> {
  const form = new FormData();
  form.append("text", text);
  if (replyTo !== null) form.append("replyTo", replyTo);
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
