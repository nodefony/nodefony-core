import type { ReactNode } from "react";

/**
 * Mini-parser ANSI 8/16 couleurs (SGR) → nodes React.
 *
 * Supporte : reset (0), bold (1/22), fg standard (30-37) + bright (90-97),
 * bg standard (40-47) + bright (100-107), default fg (39), default bg (49).
 * Les autres codes SGR (italic, underline…) sont ignorés silencieusement.
 *
 * Couleurs ajustées pour le theme dark Mantine — contraste correct sur
 * fond sombre, le cyan/blue Nodefony reste reconnaissable.
 */

const FG: Record<number, string> = {
  30: "#000000",
  31: "#e06c75",
  32: "#98c379",
  33: "#e5c07b",
  34: "#61afef",
  35: "#c678dd",
  36: "#56b6c2",
  37: "#dcdcdc",
  90: "#5c6370",
  91: "#ff7b85",
  92: "#a8d289",
  93: "#f0d090",
  94: "#7bb8f0",
  95: "#d088e0",
  96: "#66c8d0",
  97: "#ffffff",
};

const BG: Record<number, string> = {
  40: "#1a1a1a",
  41: "#7a3030",
  42: "#3a6a30",
  43: "#7a5a20",
  44: "#2a4a7a",
  45: "#5a3070",
  46: "#2a6068",
  47: "#5a5a5a",
  100: "#2a2a2a",
  101: "#8a4040",
  102: "#4a7a40",
  103: "#8a6a30",
  104: "#3a5a8a",
  105: "#6a4080",
  106: "#3a7078",
  107: "#6a6a6a",
};

interface AnsiState {
  fg?: string;
  bg?: string;
  bold?: boolean;
}

function renderSpan(text: string, s: AnsiState, key: number): ReactNode {
  if (!s.fg && !s.bg && !s.bold) return text;
  return (
    <span
      key={key}
      style={{
        color: s.fg,
        backgroundColor: s.bg,
        fontWeight: s.bold ? 600 : undefined,
        padding: s.bg ? "0 2px" : undefined,
        borderRadius: s.bg ? 2 : undefined,
      }}
    >
      {text}
    </span>
  );
}

/**
 * Convertit une string contenant des séquences ANSI en nodes React colorées.
 * Si pas de codes ANSI dans `input`, renvoie la string brute (zéro alloc).
 */
export function ansiToReact(input: string): ReactNode {
  if (!input || typeof input !== "string" || input.indexOf("\x1b[") === -1) {
    return input;
  }
  const re = /\x1b\[((?:\d+;?)*)m/g;
  const parts: ReactNode[] = [];
  let last = 0;
  let cur: AnsiState = {};
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) {
    if (m.index > last) {
      parts.push(renderSpan(input.slice(last, m.index), cur, key++));
    }
    const codes = m[1]
      .split(";")
      .filter((s) => s.length > 0)
      .map(Number);
    if (codes.length === 0) codes.push(0);
    for (const c of codes) {
      if (c === 0) cur = {};
      else if (c === 1) cur.bold = true;
      else if (c === 22) cur.bold = false;
      else if (c === 39) cur.fg = undefined;
      else if (c === 49) cur.bg = undefined;
      else if (FG[c]) cur.fg = FG[c];
      else if (BG[c]) cur.bg = BG[c];
    }
    last = m.index + m[0].length;
  }
  if (last < input.length) {
    parts.push(renderSpan(input.slice(last), cur, key++));
  }
  return parts;
}
