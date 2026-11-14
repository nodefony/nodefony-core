import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { MarkdownEditor, type IEditorHandle } from "../kit/MarkdownEditor";
import { ChatAttachments } from "./ChatAttachments";
import {
  MESSAGE_MAX_BYTES,
  type ChatMessage,
  type ChatReplyRef,
} from "./chatContract";
import { ChatMessageText } from "./ChatLinkPreview";
import {
  QUICK_REACTIONS,
  liveQuote,
  myReactions,
  replyRefOf,
  toggleReaction,
} from "./messages";
import type { IMessageGestures } from "./useChat";

/** Heure d'un message, à la minute. */
const TIME = new Intl.DateTimeFormat("fr-FR", {
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * Deux messages du même auteur à moins de cinq minutes forment un groupe :
 * le second ne répète pas l'en-tête (nom, heure).
 */
const GROUP_WINDOW_MS = 5 * 60 * 1000;

/** Le message cité où l'on saute reste surligné ce temps-là. */
const FLASH_MS = 1600;

/** Le nom lu d'une réaction proposée, sinon l'emoji lui-même. */
function reactionLabel(emoji: string): string {
  return QUICK_REACTIONS.find((item) => item.char === emoji)?.label ?? emoji;
}

/** Le message d'un refus, quel que soit le chemin. */
function refusalText(error: unknown): string {
  return error instanceof Error && error.message !== ""
    ? error.message
    : "le serveur a refusé";
}

/** Où va le focus d'un message à l'autre. */
type Move = "previous" | "next" | "first" | "last";

/**
 * Les messages du salon : un SEUL arrêt de tabulation pour toute la liste —
 * ↑/↓ d'un message à l'autre, Début/Fin aux extrémités, Entrée ouvre les
 * actions du message (le principe de la barre d'outils de l'éditeur, D37).
 * Sans lui, un bouton par message ferait deux cents arrêts.
 *
 * Guide pour un agent : la liste n'écrit rien ; chaque geste passe par
 * `gestures` (une route du contrat) et l'écran ne change qu'à l'annonce du
 * salon. La page CACHE ce que le serveur refuserait — modifier un message
 * d'autrui, retirer sans être modérateur —, c'est lui qui décide (403).
 *
 * @param me - le nom de qui regarde, s'il peut écrire ; `null` sinon
 * @param moderates - propriétaire ou modérateur du salon (XEP-0425)
 */
export function ChatMessageList({
  roomId,
  messages,
  me,
  moderates,
  gestures,
  onReply,
}: {
  roomId: string;
  messages: readonly ChatMessage[];
  me: string | null;
  moderates: boolean;
  gestures: IMessageGestures;
  onReply: (target: ChatReplyRef) => void;
}) {
  const list = useRef<HTMLUListElement>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Le message cité où l'on vient de sauter : surligné un instant.
  const [flashId, setFlashId] = useState<string | null>(null);
  useEffect(() => {
    if (flashId === null) return;
    const timer = setTimeout(() => setFlashId(null), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flashId]);
  const loaded = useMemo(
    () => new Map(messages.map((message) => [message.id, message])),
    [messages],
  );
  // Le message qui porte l'arrêt de tabulation : le choisi, sinon le dernier.
  const active =
    activeId !== null && loaded.has(activeId)
      ? activeId
      : (messages.at(-1)?.id ?? null);

  /** Donne le focus à un message de la liste. */
  const focus = (id: string) => {
    setActiveId(id);
    const row = list.current?.querySelector<HTMLElement>(
      `[data-message="${CSS.escape(id)}"]`,
    );
    row?.focus();
  };

  const move = (from: string, where: Move) => {
    const index = messages.findIndex((message) => message.id === from);
    const target =
      where === "first"
        ? 0
        : where === "last"
          ? messages.length - 1
          : index + (where === "next" ? 1 : -1);
    const next = messages.find((_, i) => i === target);
    if (next !== undefined) focus(next.id);
  };

  return (
    /* `role="log"` sur un conteneur : un `<ul>` garde son rôle de liste.
       Les nouveaux messages sont annoncés, sans voler le focus. */
    <div role="log" aria-label="Messages du salon">
      <ul ref={list} className="room-list">
        {messages.length === 0 && (
          <li className="room-empty">Aucun message pour l'instant.</li>
        )}
        {messages.map((message, index) => (
          <ChatMessageItem
            key={message.id}
            continued={continues(
              messages.find((_, i) => i === index - 1),
              message,
            )}
            roomId={roomId}
            message={message}
            quote={
              message.replyTo === undefined
                ? null
                : liveQuote(message.replyTo, loaded)
            }
            quoteLoaded={
              message.replyTo !== undefined && loaded.has(message.replyTo.id)
            }
            me={me}
            moderates={moderates}
            active={message.id === active}
            gestures={gestures}
            onActivate={() => setActiveId(message.id)}
            onMove={(where) => move(message.id, where)}
            flash={message.id === flashId}
            onJump={(id) => {
              focus(id);
              setFlashId(id);
            }}
            onReply={onReply}
          />
        ))}
      </ul>
    </div>
  );
}

/**
 * Ce message continue-t-il le groupe du précédent ? Même auteur, moins de
 * `GROUP_WINDOW_MS` d'écart, et aucun des deux retiré.
 */
function continues(
  previous: ChatMessage | undefined,
  message: ChatMessage,
): boolean {
  return (
    previous !== undefined &&
    previous.author === message.author &&
    previous.retracted === undefined &&
    message.retracted === undefined &&
    message.sentAt - previous.sentAt < GROUP_WINDOW_MS
  );
}

/** Ce qu'un message montre et permet. */
interface IItemProps {
  roomId: string;
  message: ChatMessage;
  /** La citation à afficher, tenue à jour si le message cité est chargé. */
  quote: ChatReplyRef | null;
  /** Le message cité est dans la page : la citation y mène. */
  quoteLoaded: boolean;
  me: string | null;
  moderates: boolean;
  /** Il porte l'arrêt de tabulation de la liste. */
  active: boolean;
  /** On vient d'y sauter depuis une citation : surligné un instant. */
  flash: boolean;
  /** Il continue le groupe du précédent : l'en-tête n'est que lu, pas montré. */
  continued: boolean;
  gestures: IMessageGestures;
  onActivate: () => void;
  onMove: (where: Move) => void;
  onJump: (id: string) => void;
  onReply: (target: ChatReplyRef) => void;
}

/**
 * Un message : sa citation, son texte (ou ce qu'il en reste une fois retiré),
 * ses pièces, ses réactions, et le menu de ses actions (motif Menu Button de
 * l'APG).
 */
function ChatMessageItem({
  roomId,
  message,
  quote,
  quoteLoaded,
  me,
  moderates,
  active,
  flash,
  continued,
  gestures,
  onActivate,
  onMove,
  onJump,
  onReply,
}: IItemProps) {
  const row = useRef<HTMLLIElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const cancelRetract = useRef<HTMLButtonElement>(null);
  const editor = useRef<IEditorHandle>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const retracted = message.retracted !== undefined;
  const mine = me !== null && message.author === me;
  const canAct = me !== null && !retracted;
  const myEmojis = me === null ? [] : myReactions(message.reactions, me);
  const stop = active ? 0 : -1;

  // Le menu ouvert : focus sur sa première action ; un appui hors de lui le ferme.
  useEffect(() => {
    if (!menuOpen) return;
    menu.current?.querySelector<HTMLElement>("[role^='menuitem']")?.focus();
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        (menu.current?.contains(event.target) === true ||
          menuButton.current?.contains(event.target) === true)
      )
        return;
      setMenuOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [menuOpen]);

  // Retrait demandé : le focus va sur « Annuler », le geste sans retour.
  useEffect(() => {
    if (confirming) cancelRetract.current?.focus();
  }, [confirming]);

  // Modification ouverte : le focus entre dans le champ — à l'ouverture
  // seulement, la frappe changeant `editing` à chaque touche.
  const isEditing = editing !== null;
  useEffect(() => {
    if (isEditing) editor.current?.focus();
  }, [isEditing]);

  /**
   * Un geste du serveur : son refus s'affiche sous le message.
   *
   * @returns `true` si le serveur l'a accepté
   */
  const run = async (work: Promise<void>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await work;
      return true;
    } catch (reason) {
      setError(refusalText(reason));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const closeMenu = (refocus: boolean) => {
    setMenuOpen(false);
    if (refocus) menuButton.current?.focus();
  };

  const react = (emoji: string) =>
    void run(gestures.react(message.id, toggleReaction(myEmojis, emoji)));

  const menuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [
      ...(menu.current?.querySelectorAll<HTMLElement>("[role^='menuitem']") ??
        []),
    ];
    const at = items.findIndex((item) => item === document.activeElement);
    const go = (index: number) =>
      items
        .find((_, i) => i === (index + items.length) % items.length)
        ?.focus();
    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        go(at + 1);
        break;
      case "ArrowUp":
      case "ArrowLeft":
        go(at - 1);
        break;
      case "Home":
        go(0);
        break;
      case "End":
        go(items.length - 1);
        break;
      case "Escape":
        closeMenu(true);
        break;
      case "Tab":
        setMenuOpen(false);
        return;
      default:
        return;
    }
    event.preventDefault();
  };

  const rowKey = (event: KeyboardEvent<HTMLLIElement>) => {
    if (event.target !== row.current) return;
    const where: Move | null =
      event.key === "ArrowUp"
        ? "previous"
        : event.key === "ArrowDown"
          ? "next"
          : event.key === "Home"
            ? "first"
            : event.key === "End"
              ? "last"
              : null;
    if (where !== null) {
      event.preventDefault();
      onMove(where);
      return;
    }
    if (event.key === "Enter" && canAct) {
      event.preventDefault();
      setMenuOpen(true);
    }
  };

  const saveEdit = async () => {
    if (editing === null || busy) return;
    if (!(await run(gestures.edit(message.id, editing.trim())))) return;
    setEditing(null);
    row.current?.focus();
  };

  const retractNow = async () => {
    if (!(await run(gestures.retract(message.id)))) return;
    setConfirming(false);
    row.current?.focus();
  };

  return (
    <li
      ref={row}
      data-message={message.id}
      className={[
        "room-msg",
        mine ? "is-mine" : "is-other",
        continued ? "is-continued" : "",
        retracted ? "is-retracted" : "",
        active ? "is-active" : "",
        flash ? "is-flash" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      tabIndex={stop}
      onFocus={onActivate}
      onKeyDown={rowKey}
    >
      {/* Un message qui continue un groupe garde son en-tête pour le lecteur
          d'écran : chaque élément de la liste se lit seul. */}
      <span className={continued ? "sr-only" : "room-meta"}>
        <strong>{mine ? "Vous" : message.author}</strong> ·{" "}
        {TIME.format(message.sentAt)}
        {message.editedAt !== undefined && !retracted && (
          <span
            className="room-edited"
            title={`modifié à ${TIME.format(message.editedAt)}`}
          >
            {" "}
            (modifié)
          </span>
        )}
      </span>
      {canAct && (
        <span className="msg-actions">
          <button
            ref={menuButton}
            type="button"
            className="msg-menu-btn"
            tabIndex={stop}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={`Actions du message de ${message.author}`}
            title="Actions"
            onClick={() => setMenuOpen((open) => !open)}
          >
            ⋯
          </button>
          {menuOpen && (
            <div
              ref={menu}
              className="msg-menu"
              role="menu"
              tabIndex={-1}
              aria-label={`Actions du message de ${message.author}`}
              onKeyDown={menuKey}
            >
              <div role="group" aria-label="Réagir" className="msg-menu-react">
                {QUICK_REACTIONS.map((emoji) => (
                  <div
                    key={emoji.char}
                    role="menuitemcheckbox"
                    tabIndex={-1}
                    aria-checked={myEmojis.includes(emoji.char)}
                    aria-label={emoji.label}
                    title={emoji.label}
                    onClick={() => {
                      closeMenu(true);
                      react(emoji.char);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      closeMenu(true);
                      react(emoji.char);
                    }}
                  >
                    {emoji.char}
                  </div>
                ))}
              </div>
              <MenuItem
                label="Répondre"
                onPick={() => {
                  setMenuOpen(false);
                  onReply(replyRefOf(message.id, message));
                }}
              />
              {mine && (
                <MenuItem
                  label="Modifier"
                  onPick={() => {
                    setMenuOpen(false);
                    setEditing(message.text);
                  }}
                />
              )}
              {(mine || moderates) && (
                <MenuItem
                  label="Retirer"
                  onPick={() => {
                    setMenuOpen(false);
                    setConfirming(true);
                  }}
                />
              )}
            </div>
          )}
        </span>
      )}
      <div
        className={editing === null ? "msg-bubble" : "msg-bubble is-editing"}
      >
        {quote !== null && !retracted && (
          <Quote
            quote={quote}
            tabIndex={stop}
            onJump={quoteLoaded ? () => onJump(quote.id) : null}
          />
        )}
        {retracted ? (
          <p className="room-retracted">
            {message.retracted === "moderation"
              ? "Message retiré par la modération."
              : "Message retiré par son auteur."}
          </p>
        ) : editing !== null ? (
          <div className="msg-edit">
            <MarkdownEditor
              label="Modifier le message"
              value={editing}
              maxLength={MESSAGE_MAX_BYTES}
              editor={editor}
              onChange={setEditing}
              onEnter={() => void saveEdit()}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                event.preventDefault();
                setEditing(null);
                setError(null);
                row.current?.focus();
              }}
              actions={
                <span className="msg-edit-actions">
                  <button
                    type="button"
                    className="room-btn"
                    onClick={() => {
                      setEditing(null);
                      setError(null);
                      row.current?.focus();
                    }}
                  >
                    Annuler
                  </button>
                  <button
                    type="button"
                    className="room-btn is-primary"
                    disabled={busy}
                    onClick={() => void saveEdit()}
                  >
                    Enregistrer
                  </button>
                </span>
              }
            />
          </div>
        ) : (
          message.text !== "" && (
            <ChatMessageText
              roomId={roomId}
              messageId={message.id}
              text={message.text}
            />
          )
        )}
        {!retracted &&
          message.attachments !== undefined &&
          message.attachments.length > 0 && (
            <ChatAttachments pieces={message.attachments} />
          )}
      </div>
      {confirming && (
        <div
          className="msg-confirm"
          role="group"
          aria-label="Confirmer le retrait"
        >
          <span>Retirer ce message pour tout le salon ?</span>
          <button
            ref={cancelRetract}
            type="button"
            className="room-btn"
            onClick={() => {
              setConfirming(false);
              row.current?.focus();
            }}
          >
            Annuler
          </button>
          <button
            type="button"
            className="room-btn is-danger"
            disabled={busy}
            onClick={() => void retractNow()}
          >
            Retirer
          </button>
        </div>
      )}
      {!retracted &&
        message.reactions !== undefined &&
        message.reactions.length > 0 && (
          <span className="msg-reactions">
            {message.reactions.map((reaction) => {
              const names = reaction.names.join(", ");
              const label = `${reactionLabel(reaction.emoji)} : ${reaction.names.length} — ${names}`;
              return me === null ? (
                <span
                  key={reaction.emoji}
                  className="msg-chip"
                  title={names}
                  aria-label={label}
                  role="img"
                >
                  {reaction.emoji} {reaction.names.length}
                </span>
              ) : (
                <button
                  key={reaction.emoji}
                  type="button"
                  className="msg-chip"
                  tabIndex={stop}
                  aria-pressed={myEmojis.includes(reaction.emoji)}
                  aria-label={label}
                  title={names}
                  disabled={busy}
                  onClick={() => react(reaction.emoji)}
                >
                  {reaction.emoji} {reaction.names.length}
                </button>
              );
            })}
          </span>
        )}
      {error !== null && (
        <p className="room-error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

/** Une action du menu d'un message. */
function MenuItem({ label, onPick }: { label: string; onPick: () => void }) {
  return (
    <div
      role="menuitem"
      tabIndex={-1}
      className="msg-menu-item"
      onClick={onPick}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onPick();
      }}
    >
      {label}
    </div>
  );
}

/**
 * La citation d'un message auquel celui-ci répond (XEP-0461) : un extrait en
 * texte brut. Elle mène au message cité quand il est dans la page.
 */
function Quote({
  quote,
  tabIndex,
  onJump,
}: {
  quote: ChatReplyRef;
  tabIndex: number;
  onJump: (() => void) | null;
}) {
  const body = (
    <>
      <span className="quote-head">
        <span aria-hidden="true">↩ </span>
        {quote.state === "present" ? (
          <>
            Réponse à <strong>{quote.author}</strong>
          </>
        ) : quote.state === "retracted" ? (
          "Réponse à un message retiré"
        ) : (
          "Réponse à un message introuvable"
        )}
      </span>
      {quote.state === "present" && quote.excerpt !== "" && (
        <span className="quote-text">{quote.excerpt}</span>
      )}
    </>
  );
  return onJump === null ? (
    <span className="room-quote">{body}</span>
  ) : (
    <button
      type="button"
      className="room-quote"
      tabIndex={tabIndex}
      onClick={onJump}
    >
      {body}
      {/* Le nom accessible CONTIENT le texte visible (WCAG 2.5.3), et dit où
          mène le bouton. */}
      <span className="sr-only"> — aller au message cité</span>
    </button>
  );
}
