import { loginPagePath } from "nodefony/client";
import { docsVersion, docUrl, type IDemoAbout } from "../about";
import { LEVELS } from "../Catalogue";
import { LessonCode } from "../lesson/LessonCode";
import { CHAT_LESSON } from "./chatTabs";
import { ChatComposer } from "./ChatComposer";
import type { ChatReplyRef } from "./chatContract";
import { mentionOf } from "../kit/markdown";
import { ChatMessageList } from "./ChatMessageList";
import { useChat, type IChatRoom } from "./useChat";
import { ChatPeople } from "./ChatPeople";
import { canManage, type IRoomEvent, type IRoomView } from "./rooms";
import { CreateRoomDialog, EventDialog, InviteDialog } from "./RoomForms";
import { useRef, useState } from "react";

/** Le formulaire ouvert, s'il y en a un. */
type OpenForm = "create" | "invite" | "event" | null;

/** Le message d'un refus, quel que soit le chemin. */
function refusalText(error: unknown): string {
  return error instanceof Error && error.message !== ""
    ? error.message
    : "le serveur a refusé";
}

/** Heure d'un message, à la minute. */
const TIME = new Intl.DateTimeFormat("fr-FR", {
  hour: "2-digit",
  minute: "2-digit",
});

/** Libellé de l'état de la socket, pour la pastille du haut. */
const STATE_LABEL = {
  connected: "connectée",
  connecting: "connexion…",
  reconnecting: "reconnexion…",
  disconnected: "déconnectée",
  error: "refusée",
} as const;

/**
 * Page d'apprentissage du chat (`/demo/chat`) — le gabarit commun à toutes
 * les démos : (1) ce qu'on construit, (2) la démo qui tourne, (3) le code qui
 * la fait, (4) les pièges et la suite.
 *
 * Guide pour un agent : l'écran ne connaît que `useChat()` ; le salon, la
 * sécurité et le contrat vivent côté serveur (`ChatController`) et dans les
 * fichiers partagés (`chat/chatContract.ts`, `chat/chatSchemas.ts`).
 */
export function ChatLesson({ about }: { about: IDemoAbout | null }) {
  const room = useChat();
  const version = docsVersion(about);
  return (
    <main className="lesson">
      <nav className="crumbs" aria-label="Fil d'Ariane">
        <a href="/demo">Démo</a>
        <span aria-hidden="true">›</span>
        <span aria-current="page">Le chat</span>
        <span className={`sock sock-${room.state}`}>
          Socket : {STATE_LABEL[room.state]}
        </span>
      </nav>

      <section className="lesson-intro" aria-labelledby="lesson-title">
        <p className="lesson-meta">
          <span className={`lvl ${LEVELS.intermediate.className}`}>
            {LEVELS.intermediate.label}
          </span>
          <span className="lesson-step">
            1 · Ce qu'on construit, et pourquoi
          </span>
        </p>
        <h1 id="lesson-title">Le chat — un salon temps réel</h1>
        <p>
          D'abord la plus petite chose qui marche : deux onglets, un message qui
          traverse. Puis ce qui le rend utilisable pour de vrai — historique,
          frappe en cours, salon dont l'écriture est protégée, plusieurs
          serveurs. Un chat ne prouve rien tout seul : il montre qu'
          <strong>un même contrôleur sert HTTP et WebSocket</strong>, sous la
          même sécurité.
        </p>
      </section>

      <section className="lesson-demo" aria-labelledby="lesson-demo-title">
        <h2 id="lesson-demo-title" className="lesson-step">
          2 · La démo qui tourne
        </h2>
        <ChatRoom room={room} loginPath={about?.loginPath ?? null} />
      </section>

      <LessonCode
        lesson={CHAT_LESSON}
        doc={{
          href: docUrl(version, "modules/realtime/cookbook-chat"),
          label: "Le cookbook complet, étape par étape",
        }}
      />

      <section className="lesson-traps" aria-labelledby="lesson-traps-title">
        <div>
          <h2 id="lesson-traps-title" className="lesson-step">
            4 · Les pièges
          </h2>
          <ul>
            <li>
              <strong>L'auteur venu du client ment.</strong> N'importe quel
              script se déclare « Alice » : ici l'auteur est posé par le
              serveur, d'après la session — la page ne l'envoie jamais.
            </li>
            <li>
              <strong>
                Le type d'un fichier déclaré par le navigateur ment.
              </strong>{" "}
              Une page HTML nommée <code>photo.png</code> s'exécuterait si on
              l'affichait : ici, seuls les images et les PDF reconnus à leurs
              premiers octets s'affichent, tout le reste se télécharge.
            </li>
            <li>
              <strong>
                Du Markdown rendu en HTML injecté exécute du script.
              </strong>{" "}
              Ici le texte devient des éléments React, et un lien{" "}
              <code>javascript:</code> reste du texte.
            </li>
            <li>
              <strong>
                Un aperçu de lien fait lire un site tiers PAR LE SERVEUR.
              </strong>{" "}
              Si la page envoyait l'adresse, le salon deviendrait un lecteur du
              réseau interne : ici elle désigne le lien de rang{" "}
              <code>index</code> d'un message que le serveur relit en base, et
              la lecture du site (adresse vérifiée puis épinglée, redirections
              revérifiées, aucun cookie) rend son issue comme une donnée —
              jamais une image, qui espionnerait l'adresse des lecteurs.
            </li>
            <li>
              <strong>La nature d'un bloc se calcule dans la page.</strong> Le
              texte voyage brut : JSON, tableau, diff, code et formule sont
              reconnus à la lecture, donc une règle améliorée vaut aussi pour
              les anciens messages. Le code coloré et les formules arrivent par{" "}
              <code>import()</code> au premier bloc, et une formule ne sort
              jamais de sa boîte (<code>trust: false</code>, macros bornées).
            </li>
            <li>
              <strong>La taille annoncée par une archive ment.</strong> Quelques
              Ko peuvent se déplier en gigaoctets : l'aperçu coupe la
              décompression au premier mégaoctet.
            </li>
            <li>
              <strong>
                Des octets en volume n'ont rien à faire dans la socket.
              </strong>{" "}
              Le fichier monte en HTTP, en flux jusqu'au disque ; seule
              l'annonce passe par le salon.
            </li>
            <li>
              <strong>
                Un canal dont la fabrique rend <code>null</code> est INCONNU
              </strong>{" "}
              : l'abonnement est refusé. Rendre une fonction de nettoyage, même
              vide.
            </li>
            <li>
              <strong>Une socket refusée ne lève pas d'erreur côté page</strong>{" "}
              : un refus à l'ouverture se voit comme un délai dépassé. Vérifier
              la session avant d'accuser le réseau.
            </li>
          </ul>
        </div>
        <aside className="further" aria-label="Pour aller plus loin">
          <h2 className="lesson-step">Pour aller plus loin</h2>
          <a href={docUrl(version, "modules/realtime/cookbook-chat")}>
            Le cookbook complet — @nodefony/realtime
          </a>
          <span>
            Générer l'équivalent :{" "}
            <code>npx nodefony create controller chat --kind realtime</code>
          </span>
          <span>
            Pour un agent : le skill <code>nodefony-add-realtime-channel</code>
          </span>
        </aside>
      </section>
    </main>
  );
}

/** « 14:00 – 15:00 » : le créneau d'un événement, à la minute. */
function slotOf(event: IRoomEvent): string {
  return `${TIME.format(event.start)} – ${TIME.format(event.end)}`;
}

/** Le nom d'un salon tel que la page l'affiche : l'autre personne d'un salon à deux. */
function roomLabel(item: IRoomView): string {
  return item.peer ?? item.name;
}

/** Le pictogramme d'un salon : # public, 🔒 privé, ✉ à deux. */
function roomIcon(item: IRoomView): string {
  if (item.peer !== null) return "✉";
  return item.access === "private" ? "🔒" : "#";
}

/** Un salon du rail. */
function RoomLink({ room, item }: { room: IChatRoom; item: IRoomView }) {
  const now = Date.now();
  const current = item.id === room.roomId;
  const live =
    item.event !== null && item.event.start <= now && item.event.end >= now;
  return (
    <li>
      <button
        type="button"
        className={current ? "room-link is-current" : "room-link"}
        aria-current={current ? "page" : undefined}
        onClick={() => room.openRoom(item.id)}
      >
        <span className="room-link-name">
          <span aria-hidden="true">{roomIcon(item)}</span> {roomLabel(item)}
        </span>
        {item.peer !== null ? (
          <span className="sr-only">(message privé)</span>
        ) : (
          item.access === "private" && <span className="sr-only">(privé)</span>
        )}
        {live && <span className="room-live">en cours</span>}
      </button>
    </li>
  );
}

/**
 * Le rail : les salons, les messages privés, puis les invitations qui
 * attendent une réponse (iTIP `REPLY`). Créer un salon exige une session.
 */
function RoomRail({
  room,
  onCreate,
  act,
}: {
  room: IChatRoom;
  onCreate: (() => void) | null;
  act: (work: Promise<void>) => void;
}) {
  const salons = room.rooms.filter((item) => item.peer === null);
  const direct = room.rooms.filter((item) => item.peer !== null);
  const pending = room.rooms.filter(
    (item) => item.event?.partstat === "needs-action",
  );
  return (
    <nav className="room-rail" aria-label="Salons">
      <h3 className="room-rail-title">Salons</h3>
      <ul>
        {salons.map((item) => (
          <RoomLink key={item.id} room={room} item={item} />
        ))}
      </ul>
      {onCreate !== null && (
        <button type="button" className="room-rail-add" onClick={onCreate}>
          + Nouveau salon
        </button>
      )}
      {direct.length > 0 && (
        <>
          <h3 className="room-rail-title">Messages privés</h3>
          <ul>
            {direct.map((item) => (
              <RoomLink key={item.id} room={room} item={item} />
            ))}
          </ul>
        </>
      )}
      {pending.map((item) => {
        const event = item.event;
        if (event === null) return null;
        return (
          <div key={item.id} className="room-invite">
            <strong>Invitation · {event.title}</strong>
            <span>
              {item.name} · {slotOf(event)}
            </span>
            <span className="room-invite-actions">
              <button
                type="button"
                className="room-btn is-primary"
                onClick={() => act(room.forms.reply(event.id, "accepted"))}
              >
                Accepter
              </button>
              <button
                type="button"
                className="room-btn"
                onClick={() => act(room.forms.reply(event.id, "declined"))}
              >
                Décliner
              </button>
            </span>
          </div>
        );
      })}
    </nav>
  );
}

/** Le salon : la liste, qui écrit, et l'envoi — ou l'invitation à se connecter. */
function ChatRoom({
  room,
  loginPath,
}: {
  room: IChatRoom;
  loginPath: string | null;
}) {
  const canWrite =
    room.identity?.authenticated === true && room.refusal === null;
  const insert = useRef<((text: string) => void) | null>(null);
  const replyTo = useRef<((target: ChatReplyRef) => void) | null>(null);
  const [form, setForm] = useState<OpenForm>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const current = room.rooms.find((item) => item.id === room.roomId) ?? null;
  const total = room.presence.count + room.presence.unnamed;
  const signedIn = room.identity?.authenticated === true;
  // La page CACHE ce que le serveur refuserait ; c'est lui qui décide (403).
  const manages = current?.peer === null && canManage(current.role);
  /** Un geste sans formulaire (répondre, écrire en privé) : son refus s'affiche. */
  const act = (work: Promise<void>) => {
    setNotice(null);
    work.catch((error: unknown) => setNotice(refusalText(error)));
  };
  const name = current === null ? room.roomId : roomLabel(current);

  return (
    <div className="room room-layout">
      <RoomRail
        room={room}
        onCreate={signedIn ? () => setForm("create") : null}
        act={act}
      />
      <div className="room-main">
        <div className="room-head">
          <strong>
            {current === null ? "#" : `${roomIcon(current)} `}
            {name}
          </strong>
          {room.presence.ready && (
            <span className="room-head-count">
              {total} présent{total > 1 ? "s" : ""}
            </span>
          )}
          {current?.event != null && (
            <span className="room-event">
              <strong>{current.event.title}</strong> · {slotOf(current.event)}
            </span>
          )}
          {manages && (
            <span className="room-head-actions">
              <button
                type="button"
                className="room-btn"
                onClick={() => setForm("invite")}
              >
                Inviter
              </button>
              <button
                type="button"
                className="room-btn"
                onClick={() => setForm("event")}
              >
                Planifier
              </button>
            </span>
          )}
        </div>
        {notice !== null && (
          <p className="room-notice" role="alert">
            {notice}
          </p>
        )}
        {room.refusal !== null ? (
          <p className="room-refusal" role="alert">
            {room.refusal}
          </p>
        ) : (
          <ChatMessageList
            roomId={room.roomId}
            messages={room.messages}
            me={canWrite ? (room.identity?.userIdentifier ?? null) : null}
            moderates={canManage(current?.role ?? null)}
            gestures={room.gestures}
            onReply={(target) => replyTo.current?.(target)}
          />
        )}
        {/* Qui écrit : une pastille légère au-dessus du champ, là où le regard
            est déjà. La zone garde sa hauteur — la liste ne saute pas. */}
        <div className="room-typing" aria-live="polite">
          {room.typing !== null && (
            <span className="typing-pill">
              <span className="typing-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span>
                <strong>{room.typing}</strong> écrit…
              </span>
            </span>
          )}
        </div>
        {canWrite ? (
          <ChatComposer
            author={room.identity?.userIdentifier ?? ""}
            roomId={room.roomId}
            mentions={room.people.flatMap((row) =>
              row.me || row.name === null ? [] : [row.name],
            )}
            send={room.send}
            notifyTyping={room.notifyTyping}
            insertRef={insert}
            replyRef={replyTo}
          />
        ) : (
          <div className="room-foot">
            <p>
              Lecture libre des salons publics. Pour écrire, il faut une session
              : l'auteur d'un message vient du serveur, jamais du navigateur.
            </p>
            {loginPath !== null && room.identity?.authenticated !== true && (
              <a
                className="btn primary"
                href={loginPagePath("/demo/chat", loginPath)}
              >
                Se connecter pour écrire
              </a>
            )}
          </div>
        )}
      </div>
      <ChatPeople
        presence={room.presence}
        rows={room.people}
        typing={room.typing}
        onMention={canWrite ? (who) => insert.current?.(mentionOf(who)) : null}
        onDirect={
          signedIn && current?.peer === null
            ? (userId) => act(room.forms.openDirect(userId))
            : null
        }
      />
      <CreateRoomDialog
        open={form === "create"}
        onClose={() => setForm(null)}
        forms={room.forms}
      />
      <InviteDialog
        open={form === "invite"}
        onClose={() => setForm(null)}
        forms={room.forms}
        roomName={name}
        myRole={current?.role ?? null}
      />
      <EventDialog
        open={form === "event"}
        onClose={() => setForm(null)}
        forms={room.forms}
        roomName={name}
      />
    </div>
  );
}
