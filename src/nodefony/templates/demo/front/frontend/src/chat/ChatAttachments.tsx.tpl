import { FilePreview } from "../kit/FilePreview";
import { CHAT_FILE_PATH, type ChatAttachment } from "./chatContract";

/**
 * Les pièces d'un message, dans la fenêtre du salon — la MÊME pour tous,
 * l'expéditeur compris : elles ne s'affichent qu'une fois annoncées par le
 * serveur, jamais en aperçu local.
 *
 * Guide pour un agent : le rendu suit le `kind` POSÉ PAR LE SERVEUR d'après les
 * octets (`ChatService` → `describeFile` du kit), jamais le nom du fichier ;
 * chaque pièce est une boîte du kit (`FilePreview.tsx`), la même que celle
 * qui montre une pièce avant l'envoi.
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
          ) : (
            <FilePreview
              file={piece}
              url={`${CHAT_FILE_PATH}/${encodeURIComponent(piece.id)}`}
            />
          )}
        </li>
      ))}
    </ul>
  );
}
