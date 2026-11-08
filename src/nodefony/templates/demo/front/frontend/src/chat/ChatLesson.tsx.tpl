import { useId, useState, type ComponentProps } from "react";
import { loginPagePath } from "nodefony/client";
import { docUrl, type IDemoAbout } from "../about";
import { LEVELS } from "../Catalogue";
import { LessonCode } from "./LessonCode";
import { CHAT_DECORATORS, CHAT_LESSON_STEPS } from "./lessonSteps";
import { useChat, type IChatRoom } from "./useChat";

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
  const version = about?.nodefony.version ?? null;
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
        steps={CHAT_LESSON_STEPS}
        decorators={CHAT_DECORATORS}
        stepsLabel="Étapes du cookbook"
        doc={{
          href: docUrl(version, "modules/realtime/cookbook-chat"),
          label: (step) => `L'étape ${step} dans le cookbook`,
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
  const inputId = useId();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const canWrite = room.identity?.authenticated === true;

  const onSubmit: ComponentProps<"form">["onSubmit"] = (event) => {
    event.preventDefault();
    const text = draft.trim();
    if (text === "") return;
    room
      .send(text)
      .then(() => {
        setDraft("");
        setError(null);
      })
      .catch((reason: unknown) => {
        setError(
          reason instanceof Error
            ? reason.message
            : "envoi refusé par le serveur",
        );
      });
  };

  return (
    <div className="room">
      <div className="room-head">
        <strong>#salon</strong>
        <span className="room-typing" aria-live="polite">
          {room.typing === null ? "" : `${room.typing} écrit…`}
        </span>
      </div>
      {/* `role="log"` sur un conteneur : un `<ul>` garde son rôle de liste.
          Les nouveaux messages sont annoncés, sans voler le focus. */}
      <div role="log" aria-label="Messages du salon">
        <ul className="room-list">
          {room.messages.length === 0 && (
            <li className="room-empty">Aucun message pour l'instant.</li>
          )}
          {room.messages.map((message) => (
            <li key={`${message.sentAt}|${message.author}|${message.text}`}>
              <span className="room-meta">
                <strong>{message.author}</strong> ·{" "}
                {TIME.format(message.sentAt)}
              </span>
              <span className="room-text">{message.text}</span>
            </li>
          ))}
        </ul>
      </div>
      {canWrite ? (
        <form className="room-foot" onSubmit={onSubmit}>
          <label htmlFor={inputId} className="sr-only">
            Message
          </label>
          <input
            id={inputId}
            value={draft}
            maxLength={2000}
            autoComplete="off"
            placeholder={`Écrire en tant que ${room.identity?.userIdentifier ?? ""}`}
            onChange={(event) => {
              setDraft(event.target.value);
              room.notifyTyping();
            }}
          />
          <button type="submit" className="btn primary">
            Envoyer
          </button>
          {error !== null && (
            <p className="room-error" role="alert">
              {error}
            </p>
          )}
        </form>
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
