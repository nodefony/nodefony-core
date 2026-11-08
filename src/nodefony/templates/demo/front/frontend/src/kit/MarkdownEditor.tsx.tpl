import {
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";
import {
  codeMark,
  continueList,
  linkMark,
  prefixLines,
  toggleMark,
} from "./markdown";
import { MarkdownText } from "./MarkdownText";

/** Un geste d'édition : rend le texte et la sélection à reposer. */
type Edit = (
  value: string,
  start: number,
  end: number,
) => { value: string; start: number; end: number };

/** Ce que l'éditeur prête aux outils de l'appelant (émoticônes…). */
export interface IEditorHandle {
  /** Insère un texte à la place de la sélection. */
  insert: (text: string) => void;
}

/** Les boutons de mise en forme, et leur raccourci (Ctrl ou ⌘), s'il y en a. */
const FORMATS: readonly {
  id: string;
  label: string;
  glyph: string;
  key: string | null;
  apply: Edit;
}[] = [
  {
    id: "b",
    label: "Gras",
    glyph: "G",
    key: "b",
    apply: (v, s, e) => toggleMark(v, s, e, "**"),
  },
  {
    id: "i",
    label: "Italique",
    glyph: "I",
    key: "i",
    apply: (v, s, e) => toggleMark(v, s, e, "_"),
  },
  { id: "e", label: "Code", glyph: "</>", key: "e", apply: codeMark },
  { id: "k", label: "Lien", glyph: "🔗", key: "k", apply: linkMark },
  {
    id: "ul",
    label: "Liste à puces",
    glyph: "•",
    key: null,
    apply: (v, s, e) => prefixLines(v, s, e, "- "),
  },
  {
    id: "ol",
    // Le nom CONTIENT le texte visible « 1. » (WCAG 2.5.3, « label in name »).
    label: "1. Liste numérotée",
    glyph: "1.",
    key: null,
    apply: (v, s, e) => prefixLines(v, s, e, "1. "),
  },
  {
    id: "q",
    label: "Citation",
    glyph: "❝",
    key: null,
    apply: (v, s, e) => prefixLines(v, s, e, "> "),
  },
];

/** Le nom d'un bouton, avec son raccourci. */
function titleOf(item: (typeof FORMATS)[number]): string {
  return item.key === null
    ? item.label
    : `${item.label} (Ctrl+${item.key.toUpperCase()})`;
}

/**
 * Un éditeur de texte Markdown d'une seule boîte : le champ, puis une barre
 * qui porte les outils de l'appelant, la mise en forme (gras, italique, code,
 * lien, listes, citation), l'onglet « Aperçu » et les actions.
 *
 * Guide pour un agent : brique du KIT, partagée par les démos — le salon
 * l'habille de pièces jointes et d'émoticônes (`ChatComposer.tsx`). Le texte
 * reste du Markdown BRUT (`markdown.ts`) ; « Aperçu » le montre avec le rendu
 * que verront les autres (`MarkdownText.tsx`). Chaque geste passe par une
 * fonction pure de `markdown.ts`, puis la sélection est reposée AVANT toute
 * frappe suivante (`useLayoutEffect`). Entrée sur une ligne de liste ouvre
 * l'élément suivant ; ailleurs, elle appelle `onEnter` s'il est fourni
 * (envoyer), sinon va à la ligne. Maj+Entrée va toujours à la ligne.
 *
 * @param editor - reçoit la poignée d'édition (`insert`), pour les outils
 * @param tools - outils de l'appelant, en tête de barre
 * @param actions - en fin de barre (« Envoyer »…)
 * @param above - au-dessus du champ, dans la boîte (pièces en attente…)
 */
export function MarkdownEditor({
  value,
  onChange,
  onEnter,
  label,
  placeholder,
  maxLength,
  onPaste,
  onKeyDown,
  editor,
  tools,
  actions,
  above,
}: {
  value: string;
  onChange: (value: string) => void;
  onEnter?: () => void;
  label: string;
  placeholder?: string;
  maxLength?: number;
  onPaste?: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  editor?: Ref<IEditorHandle>;
  tools?: ReactNode;
  actions?: ReactNode;
  above?: ReactNode;
}) {
  const inputId = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const [previewing, setPreviewing] = useState(false);
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
  }, [value, previewing]);

  const apply = (edit: Edit) => {
    const el = field.current;
    const next = edit(
      value,
      el?.selectionStart ?? value.length,
      el?.selectionEnd ?? value.length,
    );
    selection.current = { start: next.start, end: next.end };
    onChange(next.value);
  };

  useImperativeHandle(editor, () => ({
    insert: (text) =>
      apply((v, s, e) => ({
        value: v.slice(0, s) + text + v.slice(e),
        start: s + text.length,
        end: s + text.length,
      })),
  }));

  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      const shortcut = FORMATS.find(
        (item) => item.key === event.key.toLowerCase(),
      );
      if (shortcut !== undefined) {
        event.preventDefault();
        apply(shortcut.apply);
        return;
      }
    }
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    )
      return;
    const el = event.currentTarget;
    const list =
      el.selectionStart === el.selectionEnd
        ? continueList(value, el.selectionStart)
        : null;
    if (list !== null) {
      event.preventDefault();
      selection.current = { start: list.start, end: list.end };
      onChange(list.value);
      return;
    }
    if (onEnter !== undefined) {
      event.preventDefault();
      onEnter();
    }
  };

  return (
    <div className="md-editor">
      {above}
      <label htmlFor={inputId} className="sr-only">
        {label}
      </label>
      <textarea
        id={inputId}
        ref={field}
        rows={2}
        value={value}
        maxLength={maxLength}
        autoComplete="off"
        placeholder={placeholder}
        hidden={previewing}
        onPaste={onPaste}
        onKeyDown={keyDown}
        onChange={(event) => onChange(event.target.value)}
      />
      {previewing && (
        <div
          className="md-preview"
          role="group"
          aria-label={`Aperçu : ${label}`}
        >
          {value.trim() === "" ? (
            <p className="md-empty">Rien à prévisualiser.</p>
          ) : (
            <MarkdownText text={value} />
          )}
        </div>
      )}
      <div className="md-toolbar">
        {tools}
        <div className="md-formats" role="group" aria-label="Mise en forme">
          {FORMATS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`md-tool md-tool-${item.id}`}
              aria-label={titleOf(item)}
              title={titleOf(item)}
              disabled={previewing}
              onClick={() => apply(item.apply)}
            >
              {item.glyph}
            </button>
          ))}
        </div>
        <span className="md-spacer" />
        <button
          type="button"
          className="md-mode"
          // Le nom porte le champ : « Aperçu » seul se confond avec celui
          // d'une pièce PDF voisine. Il COMMENCE par le libellé visible.
          aria-label={`Aperçu : ${label}`}
          aria-pressed={previewing}
          onClick={() => {
            if (previewing) {
              // Retour au champ : le curseur revient à la fin du texte.
              selection.current = { start: value.length, end: value.length };
            }
            setPreviewing((was) => !was);
          }}
        >
          {/* Libellé FIXE : c'est `aria-pressed` qui dit l'état. */}
          Aperçu
        </button>
        {actions}
      </div>
    </div>
  );
}
