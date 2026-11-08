import { useRef, useState } from "react";
import { CHAT_FILE_PATH, type ChatAttachment } from "./chatContract";
import { formatSize } from "./attachments";

/**
 * Les pièces d'un message, dans la fenêtre du salon — la MÊME pour tous,
 * l'expéditeur compris : elles ne s'affichent qu'une fois annoncées par le
 * serveur, jamais en aperçu local.
 *
 * Guide pour un agent : le rendu suit le `kind` POSÉ PAR LE SERVEUR d'après les
 * octets (`ChatService`), jamais le nom du fichier. Une image s'ouvre en grand
 * dans un `<dialog>` (Échap ou « Fermer »), un texte montre ses premières
 * lignes puis se déplie (borné), un fichier se télécharge.
 */
export function ChatAttachments({
  pieces,
}: {
  pieces: readonly ChatAttachment[];
}) {
  return (
    <ul className="att-list" aria-label="Pièces jointes">
      {pieces.map((piece) => (
        <li key={piece.id}>
          {piece.expired === true ? (
            <span className="att-box att-gone">
              {piece.name} — retirée : le stockage de la démo est borné
            </span>
          ) : piece.kind === "image" ? (
            <ImagePiece piece={piece} />
          ) : piece.kind === "text" ? (
            <TextPiece piece={piece} />
          ) : (
            <FilePiece piece={piece} />
          )}
        </li>
      ))}
    </ul>
  );
}

/** L'adresse d'une pièce. */
function urlOf(piece: ChatAttachment): string {
  return `${CHAT_FILE_PATH}/${encodeURIComponent(piece.id)}`;
}

/** Une image : la vignette, puis l'image entière dans une fenêtre modale. */
function ImagePiece({ piece }: { piece: ChatAttachment }) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button
        type="button"
        className="att-thumb"
        aria-label={`Agrandir ${piece.name}`}
        onClick={() => dialog.current?.showModal()}
      >
        <img src={urlOf(piece)} alt={piece.name} loading="lazy" />
      </button>
      <dialog ref={dialog} className="att-dialog" aria-label={piece.name}>
        <img src={urlOf(piece)} alt={piece.name} />
        <p>
          {piece.name} · {formatSize(piece.size)}{" "}
          <button type="button" onClick={() => dialog.current?.close()}>
            Fermer
          </button>
        </p>
      </dialog>
    </>
  );
}

/** Lignes dépliées au plus : au-delà, le téléchargement. */
const FULL_VIEW_LINES = 200;

/** Le texte déplié, borné, avec ce qu'il en reste. */
function shown(full: string | null, lines: number): string {
  if (full === null) return "chargement…";
  const head = full.split("\n").slice(0, FULL_VIEW_LINES).join("\n");
  const rest = lines - FULL_VIEW_LINES;
  return rest > 0
    ? `${head}\n… ${rest} lignes de plus : télécharger pour tout lire`
    : head;
}

/** Un texte : nom, lignes, les premières lignes — puis tout, à la demande. */
function TextPiece({ piece }: { piece: ChatAttachment }) {
  const [full, setFull] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (full !== null) return;
    fetch(urlOf(piece))
      .then((response) =>
        response.ok
          ? response.text()
          : Promise.reject(new Error(String(response.status))),
      )
      .then(setFull)
      .catch(() => setFull("(pièce illisible, ou sortie du stockage)"));
  };
  return (
    <div className="att-box att-text">
      <div className="att-head">
        <span aria-hidden="true">📝</span>
        <strong>{piece.name}</strong>
        <span className="att-size">
          {piece.lines ?? 0} ligne{(piece.lines ?? 0) > 1 ? "s" : ""} ·{" "}
          {formatSize(piece.size)}
        </span>
      </div>
      {/* Aucune zone qui défile (le clavier ne l'atteindrait pas) : le texte
          se déplie dans la page, borné ; la suite se télécharge. */}
      <pre className="att-pre">
        {open ? shown(full, piece.lines ?? 0) : piece.preview}
      </pre>
      <div className="att-actions">
        <button type="button" aria-expanded={open} onClick={toggle}>
          {open ? "Réduire" : "Voir tout"}
        </button>
        <a href={urlOf(piece)} download={piece.name}>
          Télécharger
        </a>
      </div>
    </div>
  );
}

/** Un fichier : nom, taille, téléchargement. */
function FilePiece({ piece }: { piece: ChatAttachment }) {
  return (
    <div className="att-box">
      <div className="att-head">
        <span aria-hidden="true">📄</span>
        <strong>{piece.name}</strong>
        <span className="att-size">{formatSize(piece.size)}</span>
      </div>
      <div className="att-actions">
        <a href={urlOf(piece)} download={piece.name}>
          Télécharger
        </a>
      </div>
    </div>
  );
}
