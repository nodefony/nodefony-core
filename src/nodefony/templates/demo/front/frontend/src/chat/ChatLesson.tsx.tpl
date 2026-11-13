import { loginPagePath } from "nodefony/client";
import { docsVersion, docUrl, type IDemoAbout } from "../about";
import { LEVELS } from "../Catalogue";
import { LessonCode } from "../lesson/LessonCode";
import { CHAT_LESSON } from "./chatTabs";
import { ChatAttachments } from "./ChatAttachments";
import { ChatComposer } from "./ChatComposer";
import { MarkdownText } from "../kit/MarkdownText";
import { keyOf, useChat, type IChatRoom } from "./useChat";

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

/** Le salon : la liste, qui écrit, et l'envoi — ou l'invitation à se connecter. */
function ChatRoom({
  room,
  loginPath,
}: {
  room: IChatRoom;
  loginPath: string | null;
}) {
  const canWrite = room.identity?.authenticated === true;

  return (
    <div className="room">
      <div className="room-head">
        <strong>#salon</strong>
      </div>
      {/* `role="log"` sur un conteneur : un `<ul>` garde son rôle de liste.
          Les nouveaux messages sont annoncés, sans voler le focus. */}
      <div role="log" aria-label="Messages du salon">
        <ul className="room-list">
          {room.messages.length === 0 && (
            <li className="room-empty">Aucun message pour l'instant.</li>
          )}
          {room.messages.map((message) => (
            <li key={keyOf(message)}>
              <span className="room-meta">
                <strong>{message.author}</strong> ·{" "}
                {TIME.format(message.sentAt)}
              </span>
              {message.text !== "" && (
                <MarkdownText className="room-text" text={message.text} />
              )}
              {message.attachments !== undefined &&
                message.attachments.length > 0 && (
                  <ChatAttachments pieces={message.attachments} />
                )}
            </li>
          ))}
        </ul>
      </div>
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
          send={room.send}
          notifyTyping={room.notifyTyping}
        />
      ) : (
        <div className="room-foot">
          <p>
            Lecture libre. Pour écrire, il faut une session : l'auteur d'un
            message vient du serveur, jamais du navigateur.
          </p>
          {loginPath !== null && (
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
  );
}
