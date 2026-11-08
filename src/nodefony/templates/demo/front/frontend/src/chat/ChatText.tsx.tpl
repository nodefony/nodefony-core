import { createElement, type ReactNode } from "react";
import { parseMarkdown, type MdBlock, type MdInline } from "./markdown";

/**
 * Le texte d'un message, mis en forme — le MÊME rendu chez chacun, puisque
 * chaque page analyse le même texte brut (`markdown.ts`).
 *
 * Guide pour un agent : React échappe chaque chaîne ; aucun HTML n'est
 * injecté, et `href` n'accepte que `http:`/`https:` (filtré à l'analyse).
 * Les enfants passent en arguments de `createElement` : un message est figé,
 * jamais réordonné, et n'a donc pas besoin de clés.
 */
export function ChatText({ text }: { text: string }) {
  return createElement(
    "div",
    { className: "room-text md" },
    ...parseMarkdown(text).map(block),
  );
}

/** Un bloc, en élément. */
function block(node: MdBlock): ReactNode {
  switch (node.type) {
    case "pre":
      return (
        <pre className="md-pre">
          <code>{node.value}</code>
        </pre>
      );
    case "quote":
      return createElement("blockquote", null, ...inline(node.children));
    case "ul":
    case "ol":
      return createElement(
        node.type,
        null,
        ...node.items.map((item) => createElement("li", null, ...inline(item))),
      );
    case "p":
      return createElement("p", null, ...inline(node.children));
  }
}

/** Les morceaux d'une ligne, en éléments. */
function inline(nodes: readonly MdInline[]): ReactNode[] {
  return nodes.map(piece);
}

/** Un morceau de ligne, en élément. */
function piece(node: MdInline): ReactNode {
  if (typeof node === "string") return node;
  switch (node.type) {
    case "br":
      return createElement("br");
    case "code":
      return createElement("code", null, node.value);
    case "strong":
      return createElement("strong", null, ...inline(node.children));
    case "em":
      return createElement("em", null, ...inline(node.children));
    case "link":
      return createElement(
        "a",
        { href: node.href, target: "_blank", rel: "noopener noreferrer" },
        ...inline(node.children),
      );
  }
}
