/**
 * L'historique du terminal de développement (`service/dev/devTranscript.ts`) :
 * découpe, recomposition UTF-8, `\r`, assainissement, plafonds — sans terminal.
 */
import { describe, it, expect } from "vitest";
import {
  DevTranscript,
  TRUNCATION_MARK,
  sanitizeTerminalText,
} from "../service/dev/devTranscript";

const texts = (t: DevTranscript): string[] => t.since(0).map((e) => e.text);

describe("DevTranscript — découpe", () => {
  it("une entrée par ligne logique ; la fin sans \\n attend le paquet suivant", () => {
    const t = new DevTranscript({ now: () => 42 });
    t.ingest("server", "out", Buffer.from("un\ndeux\ntr"));
    expect(texts(t)).to.deep.equal(["un", "deux"]);
    t.ingest("server", "out", Buffer.from("ois\n"));
    expect(texts(t)).to.deep.equal(["un", "deux", "trois"]);
    expect(t.at(-1)).to.deep.equal({
      seq: 3,
      source: "server",
      stream: "out",
      text: "trois",
      at: 42,
    });
  });

  it("recompose un caractère UTF-8 coupé entre deux paquets", () => {
    const t = new DevTranscript();
    const bytes = Buffer.from("été 漢字 👍\n");
    // Coupe au milieu du « é » initial, puis au milieu de l'émoji.
    t.ingest("server", "out", bytes.subarray(0, 1));
    t.ingest("server", "out", bytes.subarray(1, 15));
    t.ingest("server", "out", bytes.subarray(15));
    expect(texts(t)).to.deep.equal(["été 漢字 👍"]);
  });

  it("une ligne en cours par couple (source, flux) : les fragments ne se mêlent pas", () => {
    const t = new DevTranscript();
    t.ingest("server", "out", "serv");
    t.ingest("assistant", "out", "assis");
    t.ingest("server", "err", "erreur\n");
    t.ingest("server", "out", "eur\n");
    t.ingest("assistant", "out", "tant\n");
    expect(
      t.since(0).map((e) => `${e.source}/${e.stream}:${e.text}`),
    ).to.deep.equal([
      "server/err:erreur",
      "server/out:serveur",
      "assistant/out:assistant",
    ]);
  });

  it("\\r repart de zéro (un indicateur d'attente n'empile pas), \\r\\n reste une fin de ligne", () => {
    const t = new DevTranscript();
    t.ingest("supervisor", "out", "\r⠋ build");
    t.ingest("supervisor", "out", "\r⠙ build");
    t.ingest("supervisor", "out", "\r✔ build terminé\n");
    t.ingest("server", "out", Buffer.from("windows\r"));
    t.ingest("server", "out", Buffer.from("\nsuite\r\n"));
    t.ingest("server", "out", "a\r");
    t.ingest("server", "out", "b\n");
    expect(texts(t)).to.deep.equal([
      "✔ build terminé",
      "windows",
      "suite",
      "b",
    ]);
  });

  it("flush termine les lignes en cours, run relie une saisie à sa sortie", () => {
    const t = new DevTranscript();
    t.ingest("user", "out", "❯ status\n", 7);
    t.ingest("command", "out", "fin sans retour", 7);
    expect(t.length).to.equal(1);
    t.flush("command");
    expect(t.since(0).map((e) => [e.source, e.text, e.run])).to.deep.equal([
      ["user", "❯ status", 7],
      ["command", "fin sans retour", undefined],
    ]);
  });

  it("ESC[2J devient un évènement, jamais un caractère de l'historique", () => {
    const cleared: string[] = [];
    const t = new DevTranscript({ onClear: (s) => cleared.push(s) });
    t.ingest("server", "out", "avant\n\x1b[2J\x1b[Haprès\n");
    expect(cleared).to.deep.equal(["server"]);
    expect(texts(t)).to.deep.equal(["avant", "après"]);
  });
});

describe("DevTranscript — plafonds", () => {
  it("plafond d'ENTRÉES : éviction par la tête, seq continue", () => {
    const t = new DevTranscript({ maxEntries: 3 });
    for (let i = 1; i <= 5; i++) t.ingest("server", "out", `l${i}\n`);
    expect(t.length).to.equal(3);
    expect(texts(t)).to.deep.equal(["l3", "l4", "l5"]);
    // Les octets des entrées évincées sont rendus : le second plafond reste juste.
    expect(t.bytes).to.equal(6);
    expect(t.at(0)?.seq).to.equal(3);
    expect(t.since(4).map((e) => e.text)).to.deep.equal(["l5"]);
    expect(t.indexOf(2)).to.equal(-1);
    expect(t.indexOf(4)).to.equal(1);
  });

  it("plafond d'OCTETS : éviction tant que la somme dépasse", () => {
    const t = new DevTranscript({ maxBytes: 10 });
    t.ingest("server", "out", "aaaa\nbbbb\n");
    expect(t.bytes).to.equal(8);
    t.ingest("server", "out", "cccc\n");
    expect(texts(t)).to.deep.equal(["bbbb", "cccc"]);
    expect(t.bytes).to.equal(8);
    t.ingest("server", "out", "été\n"); // 5 octets UTF-8
    expect(texts(t)).to.deep.equal(["cccc", "été"]);
    expect(t.bytes).to.equal(9);
  });

  it("plafond par ENTRÉE : tronquée avec marque, la suite ignorée jusqu'à la fin de ligne", () => {
    const t = new DevTranscript({ maxEntryBytes: 64 });
    t.ingest("server", "out", "x".repeat(50));
    t.ingest("server", "out", "y".repeat(50));
    t.ingest("server", "out", "z".repeat(50) + "\nnormale\n");
    const [long, normal] = texts(t);
    expect(Buffer.byteLength(long ?? "")).to.be.at.most(64);
    expect(long?.endsWith(TRUNCATION_MARK)).to.equal(true);
    expect(long).to.not.include("z");
    expect(normal).to.equal("normale");
  });

  it("la troncature ne coupe pas un caractère multi-octets", () => {
    const t = new DevTranscript({ maxEntryBytes: 40 });
    t.ingest("server", "out", "漢".repeat(40) + "\n");
    const text = t.at(0)?.text ?? "";
    expect(text).to.not.include("�");
    expect(Buffer.byteLength(text)).to.be.at.most(40);
  });
});

describe("sanitizeTerminalText — une ligne de journal ne pilote pas le terminal", () => {
  it("garde couleurs, effacement de ligne, hyperliens https et file", () => {
    const link = "\x1b]8;;https://localhost:5152\x1b\\ouvrir\x1b]8;;\x1b\\";
    const file = "\x1b]8;;file:///tmp/x.ts\x07x.ts\x1b]8;;\x07";
    const kept = `\x1b[1;32mok\x1b[0m\x1b[2K ${link} ${file}`;
    expect(sanitizeTerminalText(kept)).to.equal(kept);
  });

  it("retire déplacement de curseur, presse-papiers OSC 52, titre, écran alternatif", () => {
    const hostile =
      "a\x1b[10;5Hb\x1b[3Ac\x1b]52;c;ZWNobyBwd25lZA==\x07d" +
      "\x1b]0;titre\x07e\x1b[?1049hf\x1b7g\x1bch";
    expect(sanitizeTerminalText(hostile)).to.equal("abcdefgh");
  });

  it("retire un hyperlien javascript:, garde son texte", () => {
    const evil = "\x1b]8;;javascript:alert(1)\x1b\\clic\x1b]8;;\x1b\\";
    expect(sanitizeTerminalText(evil)).to.equal("clic\x1b]8;;\x1b\\");
  });

  it("retire les contrôles C0 et C1, rend les tabulations en espaces", () => {
    expect(sanitizeTerminalText("a\x07b\x08c\u009b2Jd\te")).to.equal(
      "abc2Jd    e",
    );
  });

  it("l'historique assainit TOUTE source", () => {
    const t = new DevTranscript();
    t.ingest("assistant", "out", "x\x1b]52;c;aGk=\x07y\n");
    expect(texts(t)).to.deep.equal(["xy"]);
  });
});
