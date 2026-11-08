import {
  Fragment,
  createElement,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  CHAT_FILE_PATH,
  type ChatAttachment,
  type ChatAttachmentFormat,
} from "./chatContract";
import { formatSize } from "./attachments";

/**
 * Les pièces d'un message, dans la fenêtre du salon — la MÊME pour tous,
 * l'expéditeur compris : elles ne s'affichent qu'une fois annoncées par le
 * serveur, jamais en aperçu local.
 *
 * Guide pour un agent : le rendu suit le `kind` POSÉ PAR LE SERVEUR d'après les
 * octets (`ChatService`, `chatPreview.ts`), jamais le nom du fichier. Une
 * image s'ouvre en grand dans un `<dialog>` (Échap ou « Fermer »), un PDF
 * dans la visionneuse du navigateur, un texte montre ses premières lignes
 * puis se déplie (borné). Archive, document et tableur montrent ce que le
 * serveur en a LU — l'index, les premiers paragraphes, le coin de la
 * première feuille ; le reste se télécharge.
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
            <Piece piece={piece} />
          )}
        </li>
      ))}
    </ul>
  );
}

/** Une pièce, selon le genre que le serveur a reconnu. */
function Piece({ piece }: { piece: ChatAttachment }) {
  switch (piece.kind) {
    case "image":
      return <ImagePiece piece={piece} />;
    case "text":
      return <TextPiece piece={piece} />;
    case "pdf":
      return <PdfPiece piece={piece} />;
    case "archive":
      return <ArchivePiece piece={piece} />;
    case "document":
      return <DocumentPiece piece={piece} />;
    case "sheet":
      return <SheetPiece piece={piece} />;
    case "file":
      return <Box icon="📄" piece={piece} />;
  }
}

/** Le nom lisible d'un format. */
const FORMAT_LABEL: Record<ChatAttachmentFormat, string> = {
  zip: "Archive ZIP",
  tar: "Archive TAR",
  "tar.gz": "Archive TAR.GZ",
  docx: "Document Word",
  odt: "Document ODT",
  xlsx: "Tableur Excel",
  ods: "Tableur ODS",
};

/** L'adresse d'une pièce. */
function urlOf(piece: ChatAttachment): string {
  return `${CHAT_FILE_PATH}/${encodeURIComponent(piece.id)}`;
}

/**
 * Une liste FIGÉE (annoncée d'un bloc par le serveur, jamais réordonnée) :
 * ses enfants passent en arguments, sans clé. `tag` nul = un fragment.
 */
function fixed(
  tag: "ul" | "tbody" | "tr" | null,
  className: string | null,
  children: readonly ReactNode[],
  last?: ReactNode,
): ReactNode {
  const all = [...children, last];
  return tag === null
    ? createElement(Fragment, null, ...all)
    : createElement(tag, className === null ? null : { className }, ...all);
}

/** Le lien de téléchargement. */
function Download({ piece }: { piece: ChatAttachment }) {
  return (
    <a href={urlOf(piece)} download={piece.name}>
      Télécharger
    </a>
  );
}

/**
 * La boîte commune : icône, nom, ce qu'on en sait — puis l'aperçu, et les
 * actions (le téléchargement, toujours).
 */
function Box({
  icon,
  piece,
  meta,
  className,
  actions,
  children,
}: {
  icon: string;
  piece: ChatAttachment;
  meta?: string;
  className?: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      className={className === undefined ? "att-box" : `att-box ${className}`}
    >
      <div className="att-head">
        <span aria-hidden="true">{icon}</span>
        <strong>{piece.name}</strong>
        <span className="att-size">
          {meta === undefined ? "" : `${meta} · `}
          {formatSize(piece.size)}
        </span>
      </div>
      {children}
      <div className="att-actions">
        {actions}
        <Download piece={piece} />
      </div>
    </div>
  );
}

/** Le bouton qui déplie un aperçu borné. */
function More({
  open,
  toggle,
  label,
}: {
  open: boolean;
  toggle: () => void;
  label: string;
}) {
  return (
    <button type="button" aria-expanded={open} onClick={toggle}>
      {open ? "Réduire" : label}
    </button>
  );
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

/**
 * Un PDF : la visionneuse du navigateur, dans une fenêtre modale. Le cadre
 * n'existe que fenêtre ouverte — un PDF n'est chargé que si on le regarde.
 */
function PdfPiece({ piece }: { piece: ChatAttachment }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <Box
      icon="📕"
      piece={piece}
      meta="PDF"
      actions={
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            dialog.current?.showModal();
          }}
        >
          Aperçu
        </button>
      }
    >
      <dialog
        ref={dialog}
        className="att-dialog att-pdf"
        aria-label={piece.name}
        onClose={() => setOpen(false)}
      >
        {open && (
          // Pas de `sandbox` : Chrome refuse d'afficher un PDF dans un cadre
          // isolé. Le serveur le sert sans script de la page et n'autorise
          // que l'application à l'encadrer (`ChatController.file`).
          // oxlint-disable-next-line react/iframe-missing-sandbox
          <iframe src={urlOf(piece)} title={`Aperçu de ${piece.name}`} />
        )}
        <p>
          {piece.name} · {formatSize(piece.size)}{" "}
          <button type="button" onClick={() => dialog.current?.close()}>
            Fermer
          </button>
        </p>
      </dialog>
    </Box>
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
  const lines = piece.lines ?? 0;
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
    <Box
      icon="📝"
      piece={piece}
      className="att-text"
      meta={`${lines} ligne${lines > 1 ? "s" : ""}`}
      actions={<More open={open} toggle={toggle} label="Voir tout" />}
    >
      {/* Aucune zone qui défile (le clavier ne l'atteindrait pas) : le texte
          se déplie dans la page, borné ; la suite se télécharge. */}
      <pre className="att-pre">{open ? shown(full, lines) : piece.preview}</pre>
    </Box>
  );
}

/** Entrées d'archive montrées avant dépli. */
const ARCHIVE_FOLDED = 5;

/** Une archive : son index, lu par le serveur — rien n'est extrait. */
function ArchivePiece({ piece }: { piece: ChatAttachment }) {
  const [open, setOpen] = useState(false);
  const entries = piece.entries ?? [];
  const total = piece.total ?? entries.length;
  const visible = open ? entries : entries.slice(0, ARCHIVE_FOLDED);
  const hidden = total - visible.length;
  return (
    <Box
      icon="🗜️"
      piece={piece}
      meta={`${piece.format === undefined ? "Archive" : FORMAT_LABEL[piece.format]} · ${total}${piece.truncated === true ? "+" : ""} entrée${total > 1 ? "s" : ""}`}
      actions={
        entries.length > ARCHIVE_FOLDED ? (
          <More
            open={open}
            toggle={() => setOpen((was) => !was)}
            label={`Voir ${entries.length} entrées`}
          />
        ) : null
      }
    >
      {fixed(
        "ul",
        "att-entries",
        visible.map((entry) =>
          createElement(
            "li",
            null,
            <span className="att-entry-name">{entry.name}</span>,
            entry.name.endsWith("/") ? null : (
              <span className="att-size">{formatSize(entry.size)}</span>
            ),
          ),
        ),
        hidden > 0 && (
          <li className="att-more">
            … et {hidden}
            {piece.truncated === true ? "+" : ""} autre{hidden > 1 ? "s" : ""}
          </li>
        ),
      )}
      {piece.truncated === true && (
        <p className="att-note">
          Aperçu partiel : la décompression s'arrête au premier mégaoctet.
        </p>
      )}
    </Box>
  );
}

/** Paragraphes montrés avant dépli. */
const DOCUMENT_FOLDED = 2;

/** Un document Word ou ODT : ses premiers paragraphes, sans mise en page. */
function DocumentPiece({ piece }: { piece: ChatAttachment }) {
  const [open, setOpen] = useState(false);
  const paragraphs = piece.paragraphs ?? [];
  return (
    <Box
      icon="📃"
      piece={piece}
      meta={
        piece.format === undefined ? "Document" : FORMAT_LABEL[piece.format]
      }
      actions={
        paragraphs.length > DOCUMENT_FOLDED ? (
          <More
            open={open}
            toggle={() => setOpen((was) => !was)}
            label="Lire le début"
          />
        ) : null
      }
    >
      <div className="att-doc">
        {paragraphs.length === 0 ? (
          <p className="att-note">
            Aucun texte lisible : télécharger pour l'ouvrir.
          </p>
        ) : (
          fixed(
            null,
            null,
            (open ? paragraphs : paragraphs.slice(0, DOCUMENT_FOLDED)).map(
              (paragraph) => createElement("p", null, paragraph),
            ),
          )
        )}
      </div>
    </Box>
  );
}

/** Lignes de tableur montrées avant dépli. */
const SHEET_FOLDED = 4;

/** Un tableur : le coin haut-gauche de sa première feuille. */
function SheetPiece({ piece }: { piece: ChatAttachment }) {
  const [open, setOpen] = useState(false);
  const rows = piece.rows ?? [];
  const visible = open ? rows : rows.slice(0, SHEET_FOLDED);
  return (
    <Box
      icon="📊"
      piece={piece}
      meta={piece.format === undefined ? "Tableur" : FORMAT_LABEL[piece.format]}
      actions={
        rows.length > SHEET_FOLDED ? (
          <More
            open={open}
            toggle={() => setOpen((was) => !was)}
            label={`Voir ${rows.length} lignes`}
          />
        ) : null
      }
    >
      {rows.length === 0 ? (
        <p className="att-note">Feuille vide : télécharger pour l'ouvrir.</p>
      ) : (
        <table className="att-sheet">
          <caption className="sr-only">
            Premières cellules de la première feuille de {piece.name}
          </caption>
          {fixed(
            "tbody",
            null,
            visible.map((row) =>
              fixed(
                "tr",
                null,
                row.map((cell) => createElement("td", null, cell)),
              ),
            ),
          )}
        </table>
      )}
    </Box>
  );
}
