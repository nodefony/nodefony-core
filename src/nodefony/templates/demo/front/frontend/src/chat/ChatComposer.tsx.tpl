import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import { ATTACHMENT_MAX_COUNT } from "./chatContract";
import {
  EMOJIS,
  attachmentProblem,
  countLines,
  formatSize,
  insertAt,
  isLargePaste,
  pastedFileName,
  previewLines,
} from "./attachments";
import { codeMark, linkMark, toggleMark } from "./markdown";

/** Une mise en forme : rend le texte et la sélection à reposer. */
type Format = (
  value: string,
  start: number,
  end: number,
) => { value: string; start: number; end: number };

/** Les boutons de mise en forme, et leur raccourci (Ctrl ou ⌘). */
const FORMATS: readonly {
  label: string;
  glyph: string;
  key: string;
  apply: Format;
}[] = [
  {
    label: "Gras",
    glyph: "G",
    key: "b",
    apply: (v, s, e) => toggleMark(v, s, e, "**"),
  },
  {
    label: "Italique",
    glyph: "I",
    key: "i",
    apply: (v, s, e) => toggleMark(v, s, e, "_"),
  },
  { label: "Code", glyph: "</>", key: "e", apply: codeMark },
  { label: "Lien", glyph: "🔗", key: "k", apply: linkMark },
];

/** Une pièce en attente d'envoi — locale à l'écrivain, rien n'est parti. */
interface IPending {
  key: string;
  file: File;
  /** Vignette d'une image (URL locale, rendue au retrait). */
  thumb: string | null;
  /** Un grand collage : ses lignes et son début. */
  pasted: { lines: number; preview: string } | null;
}

/** Une pièce en attente, née d'un fichier choisi, déposé ou collé. */
function pendingFile(file: File): IPending {
  return {
    key: crypto.randomUUID(),
    file,
    thumb: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
    pasted: null,
  };
}

/**
 * La zone d'écriture du salon : texte, émoticônes, pièces (trombone,
 * glisser-déposer, image collée) — et un grand collage devient une boîte
 * « Texte collé » au lieu d'envahir le champ.
 *
 * Guide pour un agent : tout ici reste LOCAL jusqu'à « Envoyer » ; ensuite le
 * message n'apparaît que lorsque le serveur l'annonce sur le salon. Les règles
 * (nombre, taille, grand collage) viennent de `attachments.ts`, que le serveur
 * rejoue. Entrée envoie, Maj+Entrée va à la ligne ; G, I, </> et 🔗 (ou
 * Ctrl/⌘ + B, I, E, K) écrivent le Markdown du salon (`markdown.ts`).
 */
export function ChatComposer({
  author,
  send,
  notifyTyping,
}: {
  author: string;
  send: (text: string, files: readonly File[]) => Promise<void>;
  notifyTyping: () => void;
}) {
  const inputId = useId();
  const zone = useRef<HTMLFormElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<IPending[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const pasteCount = useRef(0);
  // La sélection à reposer après le rendu du nouveau texte : en
  // `useLayoutEffect`, AVANT toute frappe suivante (un `requestAnimationFrame`
  // arrivait après une frappe rapide, qui remplaçait alors la sélection).
  const selection = useRef<{ start: number; end: number } | null>(null);
  useLayoutEffect(() => {
    const el = field.current;
    const next = selection.current;
    if (el === null || next === null) return;
    selection.current = null;
    el.focus();
    el.setSelectionRange(next.start, next.end);
  }, [draft]);

  // Les vignettes locales sont rendues au démontage.
  const thumbs = useRef(pending);
  useEffect(() => {
    thumbs.current = pending;
  }, [pending]);
  useEffect(
    () => () => {
      for (const piece of thumbs.current)
        if (piece.thumb !== null) URL.revokeObjectURL(piece.thumb);
    },
    [],
  );

  const problem = attachmentProblem(
    draft.trim(),
    pending.map((piece) => piece.file),
  );
  const blocked =
    pending.length > 0 && problem !== null && problem !== "message vide";

  const add = (pieces: IPending[]) => {
    if (pieces.length === 0) return;
    setPending((known) => [...known, ...pieces]);
    setError(null);
  };

  const remove = (key: string) => {
    setPending((known) =>
      known.filter((piece) => {
        if (piece.key !== key) return true;
        if (piece.thumb !== null) URL.revokeObjectURL(piece.thumb);
        return false;
      }),
    );
  };

  const dropThumb = (key: string) => {
    setPending((known) =>
      known.map((piece) => {
        if (piece.key !== key || piece.thumb === null) return piece;
        URL.revokeObjectURL(piece.thumb);
        return { ...piece, thumb: null };
      }),
    );
  };

  const insert = (text: string) => {
    const el = field.current;
    const start = el?.selectionStart ?? draft.length;
    const end = el?.selectionEnd ?? draft.length;
    const next = insertAt(draft, start, end, text);
    selection.current = { start: next.caret, end: next.caret };
    setDraft(next.value);
  };

  const format = (apply: Format) => {
    const el = field.current;
    const next = apply(
      draft,
      el?.selectionStart ?? draft.length,
      el?.selectionEnd ?? draft.length,
    );
    selection.current = { start: next.start, end: next.end };
    setDraft(next.value);
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...event.clipboardData.files];
    if (files.length > 0) {
      event.preventDefault();
      add(files.map(pendingFile));
      return;
    }
    const text = event.clipboardData.getData("text/plain");
    if (!isLargePaste(text)) return;
    // Trop long pour le champ : une pièce, comme un fichier.
    event.preventDefault();
    pasteCount.current += 1;
    const file = new File([text], pastedFileName(pasteCount.current), {
      type: "text/plain",
    });
    add([
      {
        key: crypto.randomUUID(),
        file,
        thumb: null,
        pasted: { lines: countLines(text), preview: previewLines(text) },
      },
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
      const files = [...(event.dataTransfer?.files ?? [])];
      if (files.length === 0) return;
      setPending((known) => [...known, ...files.map(pendingFile)]);
      setError(null);
    };
    el.addEventListener("dragover", over);
    el.addEventListener("dragleave", leave);
    el.addEventListener("drop", drop);
    return () => {
      el.removeEventListener("dragover", over);
      el.removeEventListener("dragleave", leave);
      el.removeEventListener("drop", drop);
    };
  }, []);

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
        for (const piece of pending)
          if (piece.thumb !== null) URL.revokeObjectURL(piece.thumb);
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

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape" && emojiOpen) setEmojiOpen(false);
    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      const shortcut = FORMATS.find(
        (item) => item.key === event.key.toLowerCase(),
      );
      if (shortcut !== undefined) {
        event.preventDefault();
        format(shortcut.apply);
        return;
      }
    }
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      submit();
    }
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
      {pending.length > 0 && (
        <ul className="chips" aria-label="Pièces à envoyer">
          {pending.map((piece) => (
            <li key={piece.key} className="chip">
              {piece.thumb !== null ? (
                <img
                  src={piece.thumb}
                  alt=""
                  className="chip-thumb"
                  // Le type déclaré mentait : pas une image, l'icône reprend.
                  onError={() => dropThumb(piece.key)}
                />
              ) : (
                <span className="chip-icon" aria-hidden="true">
                  {piece.pasted !== null ? "📝" : "📄"}
                </span>
              )}
              <span className="chip-body">
                <strong>
                  {piece.pasted !== null ? "Texte collé" : piece.file.name}
                </strong>
                <span className="chip-meta">
                  {piece.pasted !== null
                    ? `${piece.pasted.lines} lignes · ${formatSize(piece.file.size)}`
                    : formatSize(piece.file.size)}
                </span>
                {piece.pasted !== null && (
                  <pre className="chip-preview">{piece.pasted.preview}</pre>
                )}
              </span>
              <button
                type="button"
                className="chip-remove"
                aria-label={`Retirer ${piece.file.name}`}
                onClick={() => remove(piece.key)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="format-bar" role="group" aria-label="Mise en forme">
        {FORMATS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`tool fmt fmt-${item.key}`}
            aria-label={`${item.label} (Ctrl+${item.key.toUpperCase()})`}
            title={`${item.label} (Ctrl+${item.key.toUpperCase()})`}
            onClick={() => format(item.apply)}
          >
            {item.glyph}
          </button>
        ))}
      </div>
      <div className="composer-row">
        <button
          type="button"
          className="tool"
          aria-label={`Joindre des fichiers (${ATTACHMENT_MAX_COUNT} au plus)`}
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
            add([...(event.target.files ?? [])].map(pendingFile));
            event.target.value = "";
          }}
        />
        <div className="emoji-wrap">
          <button
            type="button"
            className="tool"
            aria-label="Émoticônes"
            aria-expanded={emojiOpen}
            onClick={() => setEmojiOpen((open) => !open)}
          >
            🙂
          </button>
          {emojiOpen && (
            <div className="emoji-grid" role="group" aria-label="Émoticônes">
              {EMOJIS.map((emoji) => (
                <button
                  key={emoji.char}
                  type="button"
                  aria-label={emoji.label}
                  title={emoji.label}
                  onClick={() => {
                    insert(emoji.char);
                    setEmojiOpen(false);
                  }}
                >
                  {emoji.char}
                </button>
              ))}
            </div>
          )}
        </div>
        <label htmlFor={inputId} className="sr-only">
          Message
        </label>
        <textarea
          id={inputId}
          ref={field}
          rows={1}
          value={draft}
          maxLength={2000}
          autoComplete="off"
          placeholder={`Écrire en tant que ${author}`}
          onPaste={onPaste}
          onKeyDown={onKeyDown}
          onChange={(event) => {
            setDraft(event.target.value);
            notifyTyping();
          }}
        />
        <button
          type="submit"
          className="btn primary"
          disabled={sending || blocked}
        >
          {sending ? "Envoi…" : "Envoyer"}
        </button>
      </div>
      {(error ?? (blocked ? problem : null)) !== null && (
        <p className="room-error" role="alert">
          {error ?? problem}
        </p>
      )}
    </form>
  );
}
