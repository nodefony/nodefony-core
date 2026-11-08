/**
 * Un Markdown réduit, lu À L'IDENTIQUE par chaque page : gras, italique,
 * code, bloc de code, lien, liste, citation — et les gestes de l'éditeur qui
 * l'écrivent.
 *
 * Guide pour un agent : brique du KIT, partagée par les démos. Le texte
 * voyage BRUT (le serveur ne le transforme pas) ; chaque page l'analyse avec
 * ces fonctions pures, puis le rend en éléments React (`MarkdownText.tsx`) —
 * jamais en HTML injecté. Un lien ne s'ouvre que vers `http:` ou `https:` :
 * `javascript:` reste du texte. L'appelant borne le texte (le salon : 2 000
 * caractères, `SendBody`), donc l'analyse aussi. L'éditeur
 * (`MarkdownEditor.tsx`) n'écrit qu'avec les fonctions de `chat-format`.
 */

/** Un morceau de ligne. */
export type MdInline =
  | string
  | { type: "strong" | "em"; children: MdInline[] }
  | { type: "code"; value: string }
  | { type: "link"; href: string; children: MdInline[] }
  | { type: "br" };

/** Un bloc du message. */
export type MdBlock =
  | { type: "p" | "quote"; children: MdInline[] }
  | { type: "pre"; value: string }
  | { type: "ul" | "ol"; items: MdInline[][] };

/** Vrai pour les seuls liens permis : `http:` ou `https:`, sans espace. */
function isSafeUrl(href: string): boolean {
  return /^https?:\/\/[^\s<>"]+$/i.test(href);
}

/** Une puce, ou un numéro de liste. */
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBER = /^\s*\d{1,9}[.)]\s+(.*)$/;

/** Caractères qu'une barre oblique inverse rend littéraux. */
const ESCAPABLE = "\\`*_[]()>#+-.!~";

/** Une lettre ou un chiffre : `_` collé à un mot (snake_case) reste du texte. */
function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[\p{L}\p{N}]/u.test(char);
}

// #region chat-markdown
/**
 * Les morceaux d'une ligne : `**gras**`, `*italique*` ou `_italique_`,
 * `` `code` ``, `[texte](https://…)` et les adresses nues `https://…`.
 * Un marqueur sans fermeture reste du texte.
 *
 * @param inLink - déjà dans un lien : pas de lien imbriqué
 */
export function parseInline(src: string, inLink = false): MdInline[] {
  const out: MdInline[] = [];
  let text = "";
  const flush = () => {
    if (text !== "") out.push(text);
    text = "";
  };
  let i = 0;
  while (i < src.length) {
    const char = src[i] ?? "";
    const next = src.charAt(i + 1);
    if (char === "\\" && next !== "" && ESCAPABLE.includes(next)) {
      text += next;
      i += 2;
      continue;
    }
    if (char === "`") {
      const close = src.indexOf("`", i + 1);
      if (close > i + 1) {
        flush();
        out.push({ type: "code", value: src.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
    }
    if (char === "*" && next === "*") {
      const close = src.indexOf("**", i + 2);
      const inner = src.slice(i + 2, close);
      if (close > i + 2 && inner.trim() === inner) {
        flush();
        out.push({ type: "strong", children: parseInline(inner, inLink) });
        i = close + 2;
        continue;
      }
    }
    if (
      (char === "*" || char === "_") &&
      !(char === "_" && isWordChar(src[i - 1]))
    ) {
      let close = src.indexOf(char, i + 1);
      // `_` fermant collé à un mot : pas une fermeture.
      if (char === "_")
        while (close > 0 && isWordChar(src[close + 1]))
          close = src.indexOf(char, close + 1);
      const inner = src.slice(i + 1, close);
      if (close > i + 1 && inner.trim() === inner) {
        flush();
        out.push({ type: "em", children: parseInline(inner, inLink) });
        i = close + 1;
        continue;
      }
    }
    if (char === "[" && !inLink) {
      const middle = src.indexOf("](", i + 1);
      const close = middle < 0 ? -1 : src.indexOf(")", middle + 2);
      const href = close < 0 ? "" : src.slice(middle + 2, close);
      if (close > 0 && middle > i + 1 && isSafeUrl(href)) {
        flush();
        out.push({
          type: "link",
          href,
          children: parseInline(src.slice(i + 1, middle), true),
        });
        i = close + 1;
        continue;
      }
    }
    if (
      !inLink &&
      (char === "h" || char === "H") &&
      !isWordChar(src[i - 1]) &&
      /^https?:\/\//i.test(src.slice(i, i + 8))
    ) {
      let end = i;
      while (end < src.length && !/[\s<>"]/.test(src[end] ?? " ")) end += 1;
      // La ponctuation finale appartient à la phrase, pas à l'adresse.
      while (end > i && ".,;:!?)".includes(src[end - 1] ?? "")) end -= 1;
      const href = src.slice(i, end);
      if (isSafeUrl(href)) {
        flush();
        out.push({ type: "link", href, children: [href] });
        i = end;
        continue;
      }
    }
    text += char;
    i += 1;
  }
  flush();
  return out;
}

/** Le saut de ligne d'un paragraphe. */
const BR: MdInline = { type: "br" };

/** Des lignes, en un seul paragraphe : un saut de ligne reste un saut. */
function joinLines(lines: readonly string[]): MdInline[] {
  return lines.flatMap((line, index) =>
    index === 0 ? parseInline(line) : [BR, ...parseInline(line)],
  );
}

/**
 * Les blocs d'un message : paragraphes (séparés par une ligne vide), bloc de
 * code entre ```, liste à puces ou numérotée, citation `>`.
 */
export function parseMarkdown(src: string): MdBlock[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MdBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "") {
      i += 1;
      continue;
    }
    if (line.trimStart().startsWith("```")) {
      const body: string[] = [];
      i += 1;
      while (
        i < lines.length &&
        !(lines[i] ?? "").trimStart().startsWith("```")
      ) {
        body.push(lines[i] ?? "");
        i += 1;
      }
      i += 1; // la clôture (absente en fin de message : le bloc va jusqu'au bout)
      blocks.push({ type: "pre", value: body.join("\n") });
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i] ?? "")) {
        body.push((lines[i] ?? "").replace(/^\s*>\s?/, ""));
        i += 1;
      }
      blocks.push({ type: "quote", children: joinLines(body) });
      continue;
    }
    const list = BULLET.test(line) ? BULLET : NUMBER.test(line) ? NUMBER : null;
    if (list !== null) {
      const items: MdInline[][] = [];
      let match = list.exec(lines[i] ?? "");
      while (match !== null) {
        items.push(parseInline(match.at(1) ?? ""));
        i += 1;
        match = i < lines.length ? list.exec(lines[i] ?? "") : null;
      }
      blocks.push({ type: list === BULLET ? "ul" : "ol", items });
      continue;
    }
    const body: string[] = [];
    while (
      i < lines.length &&
      (lines[i] ?? "").trim() !== "" &&
      !/^\s*(```|>)/.test(lines[i] ?? "") &&
      !BULLET.test(lines[i] ?? "") &&
      !NUMBER.test(lines[i] ?? "")
    ) {
      body.push(lines[i] ?? "");
      i += 1;
    }
    blocks.push({ type: "p", children: joinLines(body) });
  }
  return blocks;
}
// #endregion

// #region chat-format
/**
 * Pose un marqueur autour de la sélection — ou l'ÔTE s'il y est déjà, comme
 * le bouton « G » d'un traitement de texte.
 *
 * @returns le nouveau texte et la sélection à reposer (le même texte, marqué)
 */
export function toggleMark(
  value: string,
  start: number,
  end: number,
  mark: string,
): { value: string; start: number; end: number } {
  const before = value.slice(0, start);
  const after = value.slice(end);
  if (before.endsWith(mark) && after.startsWith(mark)) {
    return {
      value:
        before.slice(0, -mark.length) +
        value.slice(start, end) +
        after.slice(mark.length),
      start: start - mark.length,
      end: end - mark.length,
    };
  }
  return {
    value: `${before}${mark}${value.slice(start, end)}${mark}${after}`,
    start: start + mark.length,
    end: end + mark.length,
  };
}

/**
 * Du code : un bloc ``` si la sélection tient sur plusieurs lignes, sinon des
 * accents graves autour.
 */
export function codeMark(
  value: string,
  start: number,
  end: number,
): { value: string; start: number; end: number } {
  const selected = value.slice(start, end);
  if (!selected.includes("\n")) return toggleMark(value, start, end, "`");
  const open = start === 0 || value[start - 1] === "\n" ? "```\n" : "\n```\n";
  return {
    value: `${value.slice(0, start)}${open}${selected}\n\`\`\`${value.slice(end)}`,
    start: start + open.length,
    end: end + open.length,
  };
}

/**
 * Un lien : `[sélection](https://)`, l'adresse sélectionnée pour être tapée
 * aussitôt. Une sélection qui EST une adresse devient la cible.
 */
export function linkMark(
  value: string,
  start: number,
  end: number,
): { value: string; start: number; end: number } {
  const selected = value.slice(start, end);
  const isUrl = isSafeUrl(selected);
  const label = isUrl ? "lien" : selected || "lien";
  const href = isUrl ? selected : "https://";
  const inserted = `[${label}](${href})`;
  const hrefAt = start + label.length + 3;
  return {
    value: value.slice(0, start) + inserted + value.slice(end),
    start: isUrl ? start + 1 : hrefAt,
    end: isUrl ? start + 1 + label.length : hrefAt + href.length,
  };
}
// #endregion

/** Une ligne de liste : son retrait, sa puce ou son numéro, son texte. */
const LIST_ITEM = /^(\s*)(?:([-*+])|(\d{1,9})([.)]))\s+(.*)$/;

/**
 * Pose (ou ÔTE, si toutes l'ont déjà) une puce, un numéro ou un `>` en tête
 * de chaque ligne touchée par la sélection — les boutons « liste » et
 * « citation ». Une liste numérotée se compte de 1 en 1.
 *
 * @returns le texte, et les lignes touchées sélectionnées
 */
export function prefixLines(
  value: string,
  start: number,
  end: number,
  prefix: "- " | "1. " | "> ",
): { value: string; start: number; end: number } {
  const from = value.lastIndexOf("\n", start - 1) + 1;
  const stop = value.indexOf("\n", end);
  const to = stop < 0 ? value.length : stop;
  const lines = value.slice(from, to).split("\n");
  const marker =
    prefix === "1. " ? /^\d{1,9}\. / : prefix === "- " ? /^- / : /^> ?/;
  const remove = lines.every((line) => marker.test(line));
  const next = lines
    .map((line, index) => {
      if (remove) return line.replace(marker, "");
      return `${prefix === "1. " ? `${index + 1}. ` : prefix}${line}`;
    })
    .join("\n");
  return {
    value: value.slice(0, from) + next + value.slice(to),
    start: from,
    end: from + next.length,
  };
}

/**
 * Entrée sur une ligne de liste : ouvre l'élément suivant (même retrait,
 * même puce, numéro suivant) ; sur un élément VIDE, retire sa puce et sort
 * de la liste. Hors d'une liste, `null` : Entrée garde son sens ordinaire.
 *
 * @param caret - le curseur (sans sélection)
 */
export function continueList(
  value: string,
  caret: number,
): { value: string; start: number; end: number } | null {
  const from = value.lastIndexOf("\n", caret - 1) + 1;
  const stop = value.indexOf("\n", caret);
  const to = stop < 0 ? value.length : stop;
  const match = LIST_ITEM.exec(value.slice(from, to));
  if (match === null) return null;
  const indent = match.at(1) ?? "";
  const bullet = match.at(2);
  const number = match.at(3);
  const text = match.at(5) ?? "";
  if (text.trim() === "") {
    // Élément vide : on sort de la liste, la ligne reste vide.
    return {
      value: value.slice(0, from) + value.slice(to),
      start: from,
      end: from,
    };
  }
  const marker =
    bullet !== undefined
      ? `${bullet} `
      : `${Number(number ?? "0") + 1}${match.at(4) ?? "."} `;
  const inserted = `\n${indent}${marker}`;
  const at = caret + inserted.length;
  return {
    value: value.slice(0, caret) + inserted + value.slice(caret),
    start: at,
    end: at,
  };
}
