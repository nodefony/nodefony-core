/**
 * L'éditeur de l'invite (`service/dev/lineEditor.ts`, #538) : sans terminal.
 * Les touches passent par le VRAI décodeur — ce qu'un terminal envoie, pas un
 * évènement fabriqué à la main.
 */
import { describe, it, expect } from "vitest";
import { InputDecoder } from "../service/dev/inputDecoder";
import {
  LineEditor,
  PASTE_ATTACH_CHARS,
  PROMPT_MAX_ROWS,
  type EditResult,
  type IRecallSource,
} from "../service/dev/lineEditor";

const LEFT = "\x1b[D";
const RIGHT = "\x1b[C";
const UP = "\x1b[A";
const DOWN = "\x1b[B";
const HOME = "\x1b[H";
const END = "\x1b[F";
const DELETE = "\x1b[3~";
const BACKSPACE = "\x7f";
const ALT_BACKSPACE = "\x1b\x7f";
const ALT_LEFT = "\x1b[1;3D";
const ALT_ENTER = "\x1b\r";
const ENTER = "\r";
const ctrl = (letter: string): string =>
  String.fromCharCode(letter.charCodeAt(0) - 0x60);
const paste = (text: string): string => `\x1b[200~${text}\x1b[201~`;

const OPTIONS = { sigil: "❯ ", placeholder: "status · help", color: false };

/** Fait passer des octets par le décodeur puis l'éditeur ; rend les verdicts. */
function press(
  editor: LineEditor,
  bytes: string,
  source: IRecallSource | null = null,
): EditResult[] {
  const decoder = new InputDecoder();
  const results = decoder
    .feed(bytes)
    .map((event) => editor.handle(event, source));
  for (const event of decoder.flush())
    results.push(editor.handle(event, source));
  return results;
}

/** Le texte, curseur marqué d'un `|`. */
function shown(editor: LineEditor): string {
  const text = editor.text;
  // Pas de pièce jointe dans ces cas : une unité = un graphème.
  const units = Array.from(
    new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text),
    (s) => s.segment,
  );
  units.splice(editor.cursor, 0, "|");
  return units.join("");
}

function history(entries: readonly string[]): IRecallSource {
  return {
    matching: (prefix) =>
      entries.filter((e) => e.startsWith(prefix) && e !== prefix),
    suggest: (prefix) => {
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i] ?? "";
        if (e.startsWith(prefix) && e !== prefix) return e.slice(prefix.length);
      }
      return "";
    },
  };
}

describe("LineEditor — saisie et curseur", () => {
  it("compte le curseur en graphèmes : un emoji composé ne se coupe pas", () => {
    const editor = new LineEditor();
    press(editor, "a👩‍💻b");
    expect(editor.cursor).to.equal(3);
    press(editor, LEFT + LEFT);
    expect(shown(editor)).to.equal("a|👩‍💻b");
    press(editor, DELETE);
    expect(editor.text).to.equal("ab");
  });

  it("←→, Ctrl+A/E, Début/Fin, Alt+←/Alt+B par mot", () => {
    const editor = new LineEditor();
    press(editor, "inspect routes now");
    press(editor, ctrl("a"));
    expect(editor.cursor).to.equal(0);
    press(editor, ctrl("e"));
    expect(editor.cursor).to.equal(18);
    press(editor, ALT_LEFT);
    expect(shown(editor)).to.equal("inspect routes |now");
    press(editor, "\x1bb");
    expect(shown(editor)).to.equal("inspect |routes now");
    press(editor, "\x1bf");
    expect(shown(editor)).to.equal("inspect routes| now");
    press(editor, HOME);
    expect(editor.cursor).to.equal(0);
    press(editor, END);
    expect(editor.cursor).to.equal(18);
  });

  it("Retour arrière, Suppr, Ctrl+W, Alt+Retour arrière, Ctrl+U, Ctrl+K", () => {
    const editor = new LineEditor();
    press(editor, "inspect routes now");
    press(editor, BACKSPACE);
    expect(editor.text).to.equal("inspect routes no");
    press(editor, ctrl("w"));
    expect(editor.text).to.equal("inspect routes ");
    press(editor, ALT_BACKSPACE);
    expect(editor.text).to.equal("inspect ");
    press(editor, "x y" + LEFT + LEFT);
    press(editor, ctrl("k"));
    expect(shown(editor)).to.equal("inspect x|");
    press(editor, ctrl("u"));
    expect(shown(editor)).to.equal("|");
  });

  it("invite vide : `?`, Début, Fin, Ctrl+C, Ctrl+D passent au foyer suivant (D4–D6)", () => {
    const editor = new LineEditor();
    expect(press(editor, "?")).to.deep.equal(["ignored"]);
    expect(press(editor, HOME)).to.deep.equal(["ignored"]);
    expect(press(editor, END)).to.deep.equal(["ignored"]);
    expect(press(editor, ctrl("c"))).to.deep.equal(["ignored"]);
    expect(press(editor, ctrl("d"))).to.deep.equal(["ignored"]);
    expect(editor.empty).to.equal(true);
  });

  it("saisie non vide : `?` est un caractère, Ctrl+C l'efface, Ctrl+D supprime sous le curseur", () => {
    const editor = new LineEditor();
    press(editor, "a?");
    expect(editor.text).to.equal("a?");
    press(editor, LEFT + LEFT + ctrl("d"));
    expect(editor.text).to.equal("?");
    expect(press(editor, ctrl("c"))).to.deep.equal(["changed"]);
    expect(editor.empty).to.equal(true);
  });

  it("Entrée envoie ; take() rend le texte et vide le tampon", () => {
    const editor = new LineEditor();
    press(editor, "status");
    expect(press(editor, ENTER)).to.deep.equal(["submit"]);
    expect(editor.take()).to.equal("status");
    expect(editor.empty).to.equal(true);
  });

  it("Alt+Entrée et `\\` puis Entrée insèrent une fin de ligne au lieu d'envoyer (D3)", () => {
    const editor = new LineEditor();
    press(editor, "a" + ALT_ENTER + "b\\");
    expect(press(editor, ENTER)).to.deep.equal(["changed"]);
    press(editor, "c");
    expect(editor.text).to.equal("a\nb\nc");
  });

  it("la touche d'un caractère tapée n'avance pas une version sans changement", () => {
    const editor = new LineEditor();
    const before = editor.version;
    press(editor, LEFT);
    expect(editor.version).to.equal(before);
  });
});

describe("LineEditor — collage (D1, D2)", () => {
  it("insère tel quel : \\r\\n unifiés, tabulations gardées, séquences et contrôles retirés", () => {
    const editor = new LineEditor();
    const results = press(
      editor,
      paste("a\r\nb\rc\td\x1b[31mrouge\x1b[0m\x07\x1b]52;c;AAAA\x07"),
    );
    expect(results).to.deep.equal(["changed"]);
    expect(editor.text).to.equal("a\nb\nc\tdrouge");
    expect(editor.text.includes("\x1b")).to.equal(false);
  });

  it("un collage terminé par une fin de ligne ne lance rien", () => {
    const editor = new LineEditor();
    expect(press(editor, paste("status\n"))).to.deep.equal(["changed"]);
    expect(editor.text).to.equal("status\n");
  });

  it("au-delà de 5 lignes : UNE pièce jointe, sautée par le curseur, effacée d'un coup, restituée intacte", () => {
    const editor = new LineEditor();
    const text = "l1\nl2\nl3\nl4\nl5\nl6";
    press(editor, "x " + paste(text) + " y");
    expect(editor.hasAttachment).to.equal(true);
    expect(editor.text).to.equal(`x ${text} y`);
    // x, espace, pièce jointe, espace, y : 5 unités.
    expect(editor.cursor).to.equal(5);
    press(editor, LEFT + LEFT);
    expect(editor.cursor).to.equal(3);
    press(editor, BACKSPACE);
    expect(editor.text).to.equal("x  y");
    expect(editor.hasAttachment).to.equal(false);
  });

  it("au-delà de 1 000 caractères sur une ligne : pièce jointe aussi, étiquetée en caractères", () => {
    const editor = new LineEditor();
    press(editor, paste("a".repeat(PASTE_ATTACH_CHARS + 1)));
    expect(editor.hasAttachment).to.equal(true);
    const prompt = editor.render(80, OPTIONS);
    expect(prompt.lines[0]).to.equal("❯ [Collé #1 · 1\u202f001 caractères]");
  });

  it("exactement 5 lignes : reste du texte", () => {
    const editor = new LineEditor();
    press(editor, paste("1\n2\n3\n4\n5"));
    expect(editor.hasAttachment).to.equal(false);
  });
});

describe("LineEditor — la borne de 1 000 tient sur TOUS les chemins", () => {
  it("une frappe de plus de 1 000 caractères (collage sans mode 2004) devient une pièce jointe", () => {
    const editor = new LineEditor();
    press(editor, "a".repeat(PASTE_ATTACH_CHARS + 1));
    expect(editor.hasAttachment).to.equal(true);
    expect(editor.cursor).to.equal(1);
  });

  it("un rappel ou setText de plus de 1 000 caractères revient en pièce jointe", () => {
    const long = "b".repeat(5000);
    const editor = new LineEditor();
    press(editor, ctrl("p"), history([long]));
    expect(editor.hasAttachment).to.equal(true);
    expect(editor.text).to.equal(long);
    const other = new LineEditor();
    other.setText(long);
    expect(other.cursor).to.equal(1);
  });

  it("la voie rapide ASCII rend les MÊMES graphèmes : marque combinante et keycap restent entières", () => {
    const editor = new LineEditor();
    // Une tabulation TAPÉE est la touche Tab : seul un collage l'apporte.
    press(editor, paste("cafe\u0301 #\uFE0F\u20E3 a\tb"));
    // c a f é ␠ #️⃣ ␠ a ⇥ b
    expect(editor.cursor).to.equal(10);
    expect(editor.text).to.equal("cafe\u0301 #\uFE0F\u20E3 a\tb");
  });

  it("display montre l'étiquette d'une pièce jointe, text la restitue", () => {
    const editor = new LineEditor();
    press(editor, paste("1\n2\n3\n4\n5\n6"));
    expect(editor.display).to.equal("[Collé #1 · 6 lignes]");
    expect(editor.text).to.equal("1\n2\n3\n4\n5\n6");
  });
});

describe("LineEditor — historique prêté", () => {
  const source = history(["status", "inspect routes", "inspect modules"]);

  it("Ctrl+P / Ctrl+N filtrés par ce qui est tapé, brouillon rendu en redescendant", () => {
    const editor = new LineEditor();
    press(editor, "insp");
    press(editor, ctrl("p"), source);
    expect(editor.text).to.equal("inspect modules");
    press(editor, ctrl("p"), source);
    expect(editor.text).to.equal("inspect routes");
    // Au bout : rien de plus ancien, on reste.
    expect(press(editor, ctrl("p"), source)).to.deep.equal(["ignored"]);
    press(editor, ctrl("n") + ctrl("n"), source);
    expect(editor.text).to.equal("insp");
  });

  it("↑/↓ parcourent l'historique sur une saisie d'une ligne", () => {
    const editor = new LineEditor();
    press(editor, UP, source);
    expect(editor.text).to.equal("inspect modules");
    press(editor, DOWN, source);
    expect(editor.text).to.equal("");
  });

  it("↑/↓ changent d'abord de LIGNE dans une saisie de plusieurs lignes", () => {
    const editor = new LineEditor();
    press(editor, "abc" + ALT_ENTER + "de", source);
    press(editor, UP, source);
    expect(shown(editor)).to.equal("ab|c\nde");
    // Première ligne : ↑ passe à l'historique, filtré par la saisie — rien
    // ne prolonge un brouillon de deux lignes.
    expect(press(editor, UP, source)).to.deep.equal(["ignored"]);
    expect(editor.text).to.equal("abc\nde");
  });

  it("modifier un rappel le garde comme nouveau brouillon", () => {
    const editor = new LineEditor();
    press(editor, ctrl("p"), source);
    press(editor, " --json", source);
    expect(press(editor, ctrl("n"), source)).to.deep.equal(["ignored"]);
    expect(editor.text).to.equal("inspect modules --json");
  });

  it("suggestion grisée en fin de saisie, acceptée par →", () => {
    const editor = new LineEditor();
    press(editor, "st", source);
    expect(editor.suggestion(source)).to.equal("atus");
    expect(editor.render(80, OPTIONS, "atus").lines[0]).to.equal("❯ status");
    press(editor, RIGHT, source);
    expect(editor.text).to.equal("status");
    // Pas de suggestion au milieu de la saisie, ni pour le menu.
    press(editor, LEFT, source);
    expect(editor.suggestion(source)).to.equal("");
    editor.setText("/st");
    expect(editor.suggestion(source)).to.equal("");
  });

  it("sans historique : Ctrl+P et ↑ passent au foyer suivant", () => {
    const editor = new LineEditor();
    expect(press(editor, ctrl("p") + UP)).to.deep.equal(["ignored", "ignored"]);
  });
});

describe("LineEditor — rendu", () => {
  it("invite vide : le signe, le curseur sur la première case, le texte grisé après", () => {
    const prompt = new LineEditor().render(40, OPTIONS);
    expect(prompt.lines).to.deep.equal(["❯  status · help"]);
    expect(prompt.cursor).to.deep.equal({ row: 0, column: 2 });
  });

  it("replie à la largeur, continuation alignée sous la saisie, curseur suivi", () => {
    const editor = new LineEditor();
    press(editor, "abcdefgh");
    // 2 colonnes de signe + 4 de saisie.
    const prompt = editor.render(6, OPTIONS);
    // Ligne pleine, curseur en fin : une ligne de plus pour lui.
    expect(prompt.lines).to.deep.equal(["❯ abcd", "  efgh", "  "]);
    expect(prompt.cursor).to.deep.equal({ row: 2, column: 2 });
  });

  it("curseur sur la fin de ligne d'une ligne pleine : APRÈS le dernier caractère", () => {
    const editor = new LineEditor();
    press(editor, "abcd" + ALT_ENTER + "x" + LEFT + LEFT);
    const prompt = editor.render(6, OPTIONS);
    expect(prompt.lines[0]).to.equal("❯ abcd");
    expect(prompt.cursor).to.deep.equal({ row: 0, column: 6 });
  });

  it("une tabulation repliée repart d'un taquet plein", () => {
    const editor = new LineEditor();
    press(editor, paste("abcdef\tx"));
    // 6 colonnes de saisie : après abcdef, la tabulation (2 cases jusqu'au
    // taquet) ne tient plus ; repliée, elle en prend 4, pas 2.
    const prompt = editor.render(8, { ...OPTIONS, sigil: "> " });
    expect(prompt.lines).to.deep.equal(["> abcdef", "      x"]);
  });

  it("un caractère large ne se coupe pas au bord", () => {
    const editor = new LineEditor();
    press(editor, "abc漢");
    const prompt = editor.render(6, OPTIONS);
    expect(prompt.lines).to.deep.equal(["❯ abc", "  漢"]);
  });

  it(`au-delà de ${PROMPT_MAX_ROWS} lignes : une fenêtre autour du curseur, marquée ↑`, () => {
    const editor = new LineEditor();
    const lines = Array.from({ length: 12 }, (_, i) => `l${i}`);
    press(editor, lines.join(ALT_ENTER));
    const prompt = editor.render(40, OPTIONS);
    expect(prompt.lines).to.have.length(PROMPT_MAX_ROWS);
    expect(prompt.lines[0]).to.equal("↑ l4");
    expect(prompt.lines.at(-1)).to.equal("  l11");
    expect(prompt.cursor).to.deep.equal({
      row: PROMPT_MAX_ROWS - 1,
      column: 5,
    });
  });

  it("rejoue l'image depuis le cache tant que rien n'a changé", () => {
    const editor = new LineEditor();
    press(editor, "abc");
    const first = editor.render(40, OPTIONS);
    expect(editor.render(40, OPTIONS)).to.equal(first);
    press(editor, "d");
    expect(editor.render(40, OPTIONS)).to.not.equal(first);
  });
});
