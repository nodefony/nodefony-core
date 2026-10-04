/**
 * Le décodeur d'entrée (`service/dev/inputDecoder.ts`) : octets du clavier →
 * évènements, sans terminal.
 */
import { describe, it, expect } from "vitest";
import { InputDecoder, type InputEvent } from "../service/dev/inputDecoder";

const key = (
  k: string,
  mods: { ctrl?: boolean; alt?: boolean; shift?: boolean } = {},
): InputEvent => ({
  kind: "key",
  key: k,
  ctrl: mods.ctrl ?? false,
  alt: mods.alt ?? false,
  shift: mods.shift ?? false,
});

const decode = (...chunks: Array<string | Buffer>): InputEvent[] => {
  const d = new InputDecoder();
  return chunks.flatMap((c) => d.feed(c));
};

describe("InputDecoder — frappe et touches", () => {
  it("regroupe la frappe ordinaire en un évènement texte", () => {
    expect(decode("bonjour 漢字 👍")).to.deep.equal([
      { kind: "text", text: "bonjour 漢字 👍" },
    ]);
  });

  it("recompose un caractère UTF-8 coupé entre deux paquets", () => {
    const bytes = Buffer.from("é👍");
    expect(
      decode(bytes.subarray(0, 1), bytes.subarray(1, 4), bytes.subarray(4)),
    ).to.deep.equal([
      { kind: "text", text: "é" },
      { kind: "text", text: "👍" },
    ]);
  });

  it("Entrée, Retour arrière, Tab, Maj+Tab, Ctrl+lettre", () => {
    expect(decode("\r\x7f\t\x1b[Z\x03\x04\x1c\x00")).to.deep.equal([
      key("enter"),
      key("backspace"),
      key("tab"),
      key("tab", { shift: true }),
      key("c", { ctrl: true }),
      key("d", { ctrl: true }),
      key("\\", { ctrl: true }),
      key("space", { ctrl: true }),
    ]);
  });

  it("flèches, Début/Fin, PgUp/PgDn, Suppr, Inser, F1-F12 — avec modificateurs", () => {
    expect(
      decode(
        "\x1b[A\x1b[B\x1b[C\x1b[D\x1bOH\x1b[F\x1b[5~\x1b[6~\x1b[3~\x1b[2~",
      ),
    ).to.deep.equal([
      key("up"),
      key("down"),
      key("right"),
      key("left"),
      key("home"),
      key("end"),
      key("pageup"),
      key("pagedown"),
      key("delete"),
      key("insert"),
    ]);
    expect(
      decode("\x1b[1;5A\x1b[1;2D\x1b[5;3~\x1bOP\x1b[24~\x1b[1;6H"),
    ).to.deep.equal([
      key("up", { ctrl: true }),
      key("left", { shift: true }),
      key("pageup", { alt: true }),
      key("f1"),
      key("f12"),
      key("home", { ctrl: true, shift: true }),
    ]);
  });

  it("Alt+touche : Échap suivi du caractère", () => {
    expect(decode("\x1bb\x1b\x7f\x1b\r")).to.deep.equal([
      key("b", { alt: true }),
      key("backspace", { alt: true }),
      key("enter", { alt: true }),
    ]);
  });

  it("un Échap seul attend : flush() le rend, une séquence complétée ne l'est pas", () => {
    const d = new InputDecoder();
    expect(d.feed("\x1b")).to.deep.equal([]);
    expect(d.pending).to.equal(true);
    expect(d.flush()).to.deep.equal([key("escape")]);
    expect(d.feed("\x1b")).to.deep.equal([]);
    expect(d.feed("[A")).to.deep.equal([key("up")]);
    expect(d.flush()).to.deep.equal([]);
  });

  it("jamais d'exception : l'inconnu devient unknown, l'inachevé est borné", () => {
    const d = new InputDecoder();
    expect(d.feed("\x1b[99~\x1b[?1;2c")).to.deep.equal([
      { kind: "unknown", bytes: "\x1b[99~" },
      { kind: "unknown", bytes: "\x1b[?1;2c" },
    ]);
    const endless = `\x1b[${"1;".repeat(100)}`;
    expect(d.feed(endless)).to.deep.equal([
      { kind: "unknown", bytes: endless },
    ]);
    expect(d.pending).to.equal(false);
    for (const junk of ["\x1b]", "\x1bO", "\x1b[<", "\x00\xff\ud800"]) {
      expect(() => new InputDecoder().feed(junk)).to.not.throw();
    }
  });
});

describe("InputDecoder — collage entre crochets", () => {
  it("UN évènement ; \\x03 collé reste du texte, jamais Ctrl+C", () => {
    expect(decode("\x1b[200~ligne 1\r\x03ligne 2\x1b[201~a")).to.deep.equal([
      { kind: "paste", text: "ligne 1\r\x03ligne 2" },
      { kind: "text", text: "a" },
    ]);
  });

  it("à cheval sur plusieurs paquets, marque de fin coupée comprise", () => {
    const d = new InputDecoder();
    expect(d.feed("\x1b[200~abc")).to.deep.equal([]);
    expect(d.feed("def\x1b[2")).to.deep.equal([]);
    expect(d.flush()).to.deep.equal([]);
    expect(d.feed("01~")).to.deep.equal([{ kind: "paste", text: "abcdef" }]);
  });

  it("un collage CONTENANT ESC[201~ est tronqué là, la suite jamais exécutée", () => {
    const hostile = "\x1b[200~ls\x1b[201~rm -rf ~\r\x1b[201~";
    expect(decode(hostile)).to.deep.equal([{ kind: "paste", text: "ls" }]);
  });

  it("deux collages successifs restent deux collages", () => {
    expect(decode("\x1b[200~a\x1b[201~\x1b[200~b\x1b[201~")).to.deep.equal([
      { kind: "paste", text: "a" },
      { kind: "paste", text: "b" },
    ]);
  });
});

describe("InputDecoder — molette et réponses de sonde", () => {
  it("molette SGR, modificateurs compris ; un clic n'est pas une molette", () => {
    expect(
      decode("\x1b[<64;10;5M\x1b[<65;1;2M\x1b[<80;3;4M\x1b[<0;1;1M"),
    ).to.deep.equal([
      { kind: "wheel", direction: "up", column: 10, row: 5 },
      { kind: "wheel", direction: "down", column: 1, row: 2 },
      { kind: "wheel", direction: "up", column: 3, row: 4 },
      { kind: "unknown", bytes: "\x1b[<0;1;1M" },
    ]);
  });

  it("position du curseur et état d'un mode (DECRQM)", () => {
    expect(decode("\x1b[24;80R\x1b[?2026;2$y")).to.deep.equal([
      { kind: "report", report: "cursor-position", values: [24, 80] },
      { kind: "report", report: "mode", values: [2026, 2] },
    ]);
  });
});
