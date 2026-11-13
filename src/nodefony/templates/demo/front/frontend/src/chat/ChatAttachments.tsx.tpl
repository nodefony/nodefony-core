import { createElement, type ReactNode } from "react";
import { FilePreview } from "../kit/FilePreview";
import { HoverBubble, type IBubbleAnchor } from "../kit/HoverBubble";
import { formatSize, type PreviewKind } from "../kit/preview";
import { CHAT_FILE_PATH, type ChatAttachment } from "./chatContract";

/**
 * Les pièces d'un message, dans la fenêtre du salon — la MÊME pour tous,
 * l'expéditeur compris : elles ne s'affichent qu'une fois annoncées par le
 * serveur, jamais en aperçu local.
 *
 * Guide pour un agent : le rendu suit le `kind` POSÉ PAR LE SERVEUR d'après les
 * octets (`ChatService` → `describeFile` du kit), jamais le nom du fichier ;
 * chaque pièce est une boîte du kit (`FilePreview.tsx`), la même que celle
 * qui montre une pièce avant l'envoi. Une IMAGE s'affiche en vignette (la
 * boîte du kit) ; toute autre pièce tient en une PASTILLE — nom, taille, et le
 * téléchargement pour cible — dont la boîte du kit s'ouvre en bulle
 * (`kit/HoverBubble.tsx`) au survol ou au focus : une liste de pièces ne
 * prend pas la hauteur de leurs aperçus.
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
            <FilePreview file={piece} url={urlOf(piece)} />
          ) : (
            <Pill piece={piece} />
          )}
        </li>
      ))}
    </ul>
  );
}

/** L'adresse d'une pièce sur le serveur. */
function urlOf(piece: ChatAttachment): string {
  return `${CHAT_FILE_PATH}/${encodeURIComponent(piece.id)}`;
}

/** Le pictogramme d'un genre de pièce. */
function iconOf(kind: PreviewKind): string {
  switch (kind) {
    case "image":
      return "🖼️";
    case "text":
      return "📝";
    case "pdf":
      return "📕";
    case "archive":
      return "🗜️";
    case "document":
      return "📃";
    case "sheet":
      return "📊";
    case "file":
      return "📄";
  }
}

/**
 * Une pastille : le nom et la taille, le téléchargement pour cible ; la boîte
 * d'aperçu s'ouvre en bulle, construite SEULEMENT bulle ouverte.
 */
function Pill({ piece }: { piece: ChatAttachment }) {
  return (
    <HoverBubble
      bubble={createElement(FilePreview, { file: piece, url: urlOf(piece) })}
      trigger={pillTrigger(piece)}
    />
  );
}

/** Le déclencheur d'une pastille, défini hors du rendu. */
function pillTrigger(
  piece: ChatAttachment,
): (anchor: IBubbleAnchor) => ReactNode {
  return (anchor) => createElement(PillLink, { piece, anchor });
}

/** Le lien de la pastille : le téléchargement, décrit par la bulle. */
function PillLink({
  piece,
  anchor,
}: {
  piece: ChatAttachment;
  anchor: IBubbleAnchor;
}) {
  return (
    <a
      className="att-pill"
      href={urlOf(piece)}
      download={piece.name}
      aria-describedby={anchor["aria-describedby"]}
      onClick={anchor.onClick}
    >
      <span aria-hidden="true">{iconOf(piece.kind)}</span>
      <span className="att-pill-name">{piece.name}</span>
      <span className="att-size">{formatSize(piece.size)}</span>
    </a>
  );
}
