import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type RefObject,
} from "react";
import { FilePreview } from "../kit/FilePreview";
import { MarkdownEditor, type IEditorHandle } from "../kit/MarkdownEditor";
import { describeFile, type IFilePreview } from "../kit/preview";
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_COUNT,
  MESSAGE_MAX_BYTES,
} from "./chatContract";
import {
  EMOJIS,
  attachmentProblem,
  isLargePaste,
  pastedFileName,
  textProblem,
} from "./attachments";

/** Une pièce en attente d'envoi — locale à l'écrivain, rien n'est parti. */
interface IPending {
  key: string;
  file: File;
  /** Adresse locale du contenu (`blob:`), posée avec l'aperçu, rendue au retrait. */
  url: string | null;
  /** L'aperçu lu dans le navigateur ; `null` pendant la lecture. */
  preview: IFilePreview | null;
}

/** Une pièce en attente, née d'un fichier choisi, déposé ou collé. */
function pendingFile(file: File): IPending {
  return { key: crypto.randomUUID(), file, url: null, preview: null };
}

/**
 * L'adresse locale d'une pièce lue. Un PDF est RETYPÉ d'après ses octets :
 * le type déclaré vient du nom, et un fichier nommé `.html` ouvert dans un
 * onglet s'exécuterait sous l'origine de la page.
 */
function localUrl(file: File, preview: IFilePreview): string {
  return URL.createObjectURL(
    preview.kind === "pdf"
      ? new Blob([file], { type: "application/pdf" })
      : file,
  );
}

/** Rend l'adresse locale d'une pièce, s'il y en a une. */
function release(piece: IPending): void {
  if (piece.url !== null) URL.revokeObjectURL(piece.url);
}

/**
 * L'aperçu d'une pièce, lu DANS LE NAVIGATEUR par le même code que le
 * serveur (`describeFile`). Une pièce vide ou trop grosse n'est pas lue :
 * l'envoi la refusera.
 */
async function previewOf(file: File): Promise<IFilePreview> {
  if (file.size === 0 || file.size > ATTACHMENT_MAX_BYTES)
    return { kind: "file" };
  try {
    const described = await describeFile(
      new Uint8Array(await file.arrayBuffer()),
    );
    return described.fields;
  } catch {
    return { kind: "file" };
  }
}

/**
 * La zone d'écriture du salon : l'éditeur Markdown du kit, habillé des
 * pièces jointes (trombone, glisser-déposer, image collée) et des
 * émoticônes — et un grand collage devient une pièce au lieu d'envahir le
 * champ.
 *
 * Guide pour un agent : tout ici reste LOCAL jusqu'à « Envoyer » ; ensuite le
 * message n'apparaît que lorsque le serveur l'annonce sur le salon. Une pièce
 * montre son aperçu dès qu'on la choisit — les MÊMES boîtes que le salon
 * (`FilePreview.tsx`), calculées dans le navigateur par `describeFile` ; le
 * serveur refait le sien à la réception et ne croit jamais celui-ci. Les
 * règles (nombre, taille, grand collage) viennent de `attachments.ts`, que le
 * serveur rejoue. L'édition (mise en forme, listes, aperçu) est celle du kit
 * (`MarkdownEditor.tsx`).
 */
export function ChatComposer({
  author,
  send,
  notifyTyping,
  insertRef,
}: {
  author: string;
  send: (text: string, files: readonly File[]) => Promise<void>;
  notifyTyping: () => void;
  /** Reçoit de quoi insérer un texte dans le champ (une `@mention` du panneau). */
  insertRef?: RefObject<((text: string) => void) | null>;
}) {
  const zone = useRef<HTMLFormElement>(null);
  const editor = useRef<IEditorHandle>(null);

  // Le panneau des présents écrit `@nom` ici, sans tenir l'éditeur lui-même.
  useEffect(() => {
    if (insertRef === undefined) return;
    insertRef.current = (text) => editor.current?.insert(text);
    return () => {
      insertRef.current = null;
    };
  }, [insertRef]);
  const picker = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<IPending[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const pasteCount = useRef(0);

  // Les adresses locales sont rendues au démontage.
  const known = useRef(pending);
  useEffect(() => {
    known.current = pending;
  }, [pending]);
  useEffect(
    () => () => {
      for (const piece of known.current) release(piece);
    },
    [],
  );

  const problem = attachmentProblem(
    draft.trim(),
    pending.map((piece) => piece.file),
  );
  // Une pièce en attente ou un texte trop lourd : le motif s'affiche tout de
  // suite, sans attendre « Envoyer ».
  const blocked =
    problem !== null &&
    problem !== "message vide" &&
    (pending.length > 0 || textProblem(draft.trim()) !== null);

  // Ajoute les pièces, puis lit leur aperçu ; une pièce retirée entre-temps
  // ne revient pas (le `map` ne la trouve plus). Stable : rien que des setters.
  const add = useCallback((files: readonly File[]) => {
    if (files.length === 0) return;
    const pieces = files.map(pendingFile);
    setPending((list) => [...list, ...pieces]);
    setError(null);
    for (const piece of pieces)
      void previewOf(piece.file).then((preview) => {
        const url = localUrl(piece.file, preview);
        setPending((list) => {
          // Retirée pendant la lecture : son adresse est rendue aussitôt.
          if (!list.some((item) => item.key === piece.key))
            URL.revokeObjectURL(url);
          return list.map((item) =>
            item.key === piece.key ? { ...item, preview, url } : item,
          );
        });
      });
  }, []);

  const remove = (key: string) => {
    setPending((list) =>
      list.filter((piece) => {
        if (piece.key !== key) return true;
        release(piece);
        return false;
      }),
    );
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...event.clipboardData.files];
    if (files.length > 0) {
      event.preventDefault();
      add(files);
      return;
    }
    const text = event.clipboardData.getData("text/plain");
    if (!isLargePaste(text)) return;
    // Trop long pour le champ : une pièce, comme un fichier.
    event.preventDefault();
    pasteCount.current += 1;
    add([
      new File([text], pastedFileName(pasteCount.current), {
        type: "text/plain",
      }),
    ]);
  };

  // Glisser-déposer : un raccourci de souris — le trombone en est l'équivalent
  // clavier. Écouté sur le formulaire, retiré au démontage.
  useEffect(() => {
    const el = zone.current;
    if (el === null) return;
    const over = (event: DragEvent) => {
      event.preventDefault();
      setDragging(true);
    };
    const leave = (event: DragEvent) => {
      if (event.target === el) setDragging(false);
    };
    const drop = (event: DragEvent) => {
      event.preventDefault();
      setDragging(false);
      add([...(event.dataTransfer?.files ?? [])]);
    };
    el.addEventListener("dragover", over);
    el.addEventListener("dragleave", leave);
    el.addEventListener("drop", drop);
    return () => {
      el.removeEventListener("dragover", over);
      el.removeEventListener("dragleave", leave);
      el.removeEventListener("drop", drop);
    };
  }, [add]);

  const submit = () => {
    const text = draft.trim();
    if (problem !== null || sending) {
      if (problem !== null && problem !== "message vide") setError(problem);
      return;
    }
    setSending(true);
    send(
      text,
      pending.map((piece) => piece.file),
    )
      .then(() => {
        for (const piece of pending) release(piece);
        setDraft("");
        setPending([]);
        setError(null);
      })
      .catch((reason: unknown) => {
        setError(
          reason instanceof Error
            ? reason.message
            : "envoi refusé par le serveur",
        );
      })
      .finally(() => setSending(false));
  };

  return (
    <form
      ref={zone}
      className={
        dragging ? "room-foot composer dragging" : "room-foot composer"
      }
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <MarkdownEditor
        label="Message"
        value={draft}
        maxLength={MESSAGE_MAX_BYTES}
        placeholder={`Écrire en tant que ${author}`}
        onChange={(value) => {
          setDraft(value);
          notifyTyping();
        }}
        onEnter={submit}
        onPaste={onPaste}
        onKeyDown={(event) => {
          if (event.key === "Escape" && emojiOpen) {
            event.preventDefault();
            setEmojiOpen(false);
          }
        }}
        above={
          pending.length > 0 && (
            <ul className="pending" aria-label="Pièces à envoyer">
              {pending.map((piece) => (
                <li key={piece.key} className="pending-piece">
                  <FilePreview
                    file={{
                      name: piece.file.name,
                      size: piece.file.size,
                      ...(piece.preview ?? { kind: "file" }),
                    }}
                    url={piece.url}
                    local
                  />
                  {piece.preview === null && (
                    <span className="pending-reading">lecture…</span>
                  )}
                  <button
                    type="button"
                    className="pending-remove"
                    aria-label={`Retirer ${piece.file.name}`}
                    title={`Retirer ${piece.file.name}`}
                    onClick={() => remove(piece.key)}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )
        }
        editor={editor}
        tools={
          <>
            <button
              type="button"
              className="md-tool"
              aria-label={`Joindre des fichiers (${ATTACHMENT_MAX_COUNT} au plus)`}
              title={`Joindre des fichiers (${ATTACHMENT_MAX_COUNT} au plus)`}
              onClick={() => picker.current?.click()}
            >
              📎
            </button>
            <input
              ref={picker}
              type="file"
              multiple
              hidden
              onChange={(event) => {
                add([...(event.target.files ?? [])]);
                event.target.value = "";
              }}
            />
            <div className="emoji-wrap">
              <button
                type="button"
                className="md-tool"
                aria-label="Émoticônes"
                title="Émoticônes"
                aria-expanded={emojiOpen}
                onClick={() => setEmojiOpen((open) => !open)}
              >
                🙂
              </button>
              {emojiOpen && (
                <div
                  className="emoji-grid"
                  role="group"
                  aria-label="Émoticônes"
                >
                  {EMOJIS.map((emoji) => (
                    <button
                      key={emoji.char}
                      type="button"
                      aria-label={emoji.label}
                      title={emoji.label}
                      onClick={() => {
                        editor.current?.insert(emoji.char);
                        setEmojiOpen(false);
                      }}
                    >
                      {emoji.char}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        }
        actions={
          <button
            type="submit"
            className="btn primary md-send"
            disabled={sending || blocked}
          >
            {sending ? "Envoi…" : "Envoyer"}
          </button>
        }
      />
      {(error ?? (blocked ? problem : null)) !== null && (
        <p className="room-error" role="alert">
          {error ?? problem}
        </p>
      )}
    </form>
  );
}
