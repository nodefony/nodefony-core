/**
 * L'historique du terminal de développement (`service/dev/devTranscript.ts`) :
 * découpe, recomposition UTF-8, `\r`, assainissement, plafonds — sans terminal.
 */
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { describe, it, expect } from "vitest";
import {
  DevTranscript,
  TRUNCATION_MARK,
  sanitizeTerminalText,
  transcriptEntryCost,
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
      channel: "server",
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

  it("une ligne en cours par couple (canal, flux) : les fragments ne se mêlent pas", () => {
    const t = new DevTranscript();
    t.ingest("server", "out", "serv");
    t.ingest("agent:1", "out", "assis");
    t.ingest("server", "err", "erreur\n");
    t.ingest("server", "out", "eur\n");
    t.ingest("agent:1", "out", "tant\n");
    expect(
      t.since(0).map((e) => `${e.channel}/${e.stream}:${e.text}`),
    ).to.deep.equal([
      "server/err:erreur",
      "server/out:serveur",
      "agent:1/out:assistant",
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

  it("flush termine les lignes en cours d'un canal — la saisie et sa sortie partagent run:<n>", () => {
    const t = new DevTranscript();
    t.ingest("run:7", "out", "❯ status\n");
    t.ingest("run:7", "out", "fin sans retour");
    expect(t.length).to.equal(1);
    t.flush("run:7");
    expect(t.since(0).map((e) => [e.channel, e.text])).to.deep.equal([
      ["run:7", "❯ status"],
      ["run:7", "fin sans retour"],
    ]);
  });

  it("flush d'un canal ne touche pas un canal dont l'identifiant le prolonge", () => {
    const t = new DevTranscript();
    t.ingest("vite", "out", "court");
    t.ingest("vite:admin", "out", "long");
    t.flush("vite");
    expect(t.since(0).map((e) => e.text)).to.deep.equal(["court"]);
    expect(t.partial("vite:admin")).to.equal("long");
  });

  it("la ligne en cours d'un canal est celle du flux écrit en DERNIER — là où est le curseur", () => {
    const t = new DevTranscript();
    t.ingest("run:1", "err", "Mot de passe : ");
    expect(t.partial("run:1")).to.equal("Mot de passe : ");
    t.ingest("run:1", "out", "\r⠋ chargement");
    t.ingest("run:1", "out", "\r⠙ chargement");
    expect(t.partial("run:1")).to.equal("⠙ chargement");
    t.ingest("run:1", "err", "?");
    expect(t.partial("run:1")).to.equal("Mot de passe : ?");
    expect(t.partial("run:2")).to.equal("");
  });

  it("flush ne verse pas une ligne réduite à son effacement (tourniquet arrêté)", () => {
    const t = new DevTranscript();
    t.ingest("run:1", "out", "\r⠋ chargement\r\x1b[2K");
    t.ingest("run:1", "err", "Mot de passe : ");
    t.flush("run:1");
    expect(t.since(0).map((e) => e.text)).to.deep.equal(["Mot de passe : "]);
  });

  it("ESC[2J devient un évènement, jamais un caractère de l'historique", () => {
    const cleared: string[] = [];
    const t = new DevTranscript({ onClear: (s) => cleared.push(s) });
    t.ingest("server", "out", "avant\n\x1b[2J\x1b[Haprès\n");
    expect(cleared).to.deep.equal(["server"]);
    expect(texts(t)).to.deep.equal(["avant", "après"]);
  });
});

describe("DevTranscript — horloge", () => {
  it("une lecture d'horloge par paquet : ses lignes partagent l'heure du paquet qui les finit", () => {
    let ticks = 0;
    const t = new DevTranscript({ now: () => ++ticks });
    t.ingest("server", "out", "a\nb\nc\n");
    t.ingest("server", "out", "sans fin");
    expect(ticks, "un paquet sans ligne finie ne lit pas l'heure").to.equal(1);
    t.ingest("server", "out", " d\n");
    t.flush();
    t.ingest("server", "out", "e");
    t.flush("server");
    expect(t.since(0).map((e) => `${e.text}@${e.at}`)).to.deep.equal([
      "a@1",
      "b@1",
      "c@1",
      "sans fin d@2",
      "e@3",
    ]);
  });
});

describe("DevTranscript — plafonds", () => {
  it("plafond d'ENTRÉES : éviction par la tête, seq continue", () => {
    const t = new DevTranscript({ maxEntries: 3 });
    for (let i = 1; i <= 5; i++) t.ingest("server", "out", `l${i}\n`);
    expect(t.length).to.equal(3);
    expect(texts(t)).to.deep.equal(["l3", "l4", "l5"]);
    // La mémoire des entrées évincées est rendue : le second plafond reste juste.
    expect(t.bytes).to.equal(3 * transcriptEntryCost("l3"));
    expect(t.at(0)?.seq).to.equal(3);
    expect(t.since(4).map((e) => e.text)).to.deep.equal(["l5"]);
    expect(t.indexOf(2)).to.equal(-1);
    expect(t.indexOf(4)).to.equal(1);
  });

  it("plafond de MÉMOIRE : éviction tant que la somme dépasse", () => {
    const ascii = transcriptEntryCost("aaaa");
    const t = new DevTranscript({ maxBytes: 2 * ascii + 2 });
    t.ingest("server", "out", "aaaa\nbbbb\n");
    expect(t.bytes).to.equal(2 * ascii);
    t.ingest("server", "out", "cccc\n");
    expect(texts(t)).to.deep.equal(["bbbb", "cccc"]);
    expect(t.bytes).to.equal(2 * ascii);
    // Trois caractères hors ASCII : deux octets chacun sous V8, soit deux de
    // plus que « cccc » — tient sous le plafond, au prix de « bbbb ».
    t.ingest("server", "out", "été\n");
    expect(texts(t)).to.deep.equal(["cccc", "été"]);
    expect(t.bytes).to.equal(2 * ascii + 2);
  });

  it("le coût d'une entrée est sa mémoire : surcharge fixe, deux octets par caractère hors ASCII", () => {
    const overhead = transcriptEntryCost("");
    expect(overhead).to.be.within(100, 200);
    expect(transcriptEntryCost("abc")).to.equal(overhead + 3);
    expect(transcriptEntryCost("✓✓✓")).to.equal(overhead + 6);
    expect(transcriptEntryCost("a✓")).to.equal(overhead + 4);
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

  // `slice` rend une chaîne qui RETIENT sa mère (V8) : une ligne courte
  // découpée d'un paquet de 60 Ko garderait les 60 Ko vivants, et la borne
  // d'octets ne bornerait plus que des chiffres. Mesuré avant correctif :
  // ~115 Mio retenus pour 40 Ko nominaux (2 000 paquets).
  it.each([
    ["Buffer (paquet relayé)", (s: string): Buffer | string => Buffer.from(s)],
    ["chaîne (tranche de DevTerminal)", (s: string): Buffer | string => s],
  ])(
    "la borne borne la MÉMOIRE : une ligne courte ne retient pas son paquet — %s",
    (_label, shape) => {
      setFlagsFromString("--expose-gc");
      const gc = runInNewContext("gc") as () => void;
      const heap = (): number => {
        gc();
        gc();
        return process.memoryUsage().heapUsed;
      };
      const t = new DevTranscript();
      const before = heap();
      for (let i = 0; i < 500; i++) {
        t.ingest(
          "server",
          "out",
          shape("x".repeat(60_000) + "\rligne-survivante-" + i + "\n"),
        );
      }
      const retained = heap() - before;
      expect(t.length).to.equal(500);
      expect(t.bytes).to.be.at.most(
        500 * transcriptEntryCost("ligne-survivante-499"),
      );
      // 500 × 60 Ko = 30 Mio si les paquets survivent ; quelques dizaines de Ko sinon.
      expect(retained, `${retained} octets retenus`).to.be.below(
        4 * 1024 * 1024,
      );
    },
  );

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

  it("surfrappe de man : X⌫X en gras, _⌫X souligné, une séquence par série — jamais « NNAAMMEE »", () => {
    expect(sanitizeTerminalText("N\bNA\bAM\bME\bE")).to.equal(
      "\x1b[1mNAME\x1b[22m",
    );
    expect(sanitizeTerminalText("_\bC_\bO")).to.equal("\x1b[4mCO\x1b[24m");
    // Gras, puis souligné, puis texte nu : chaque série se referme.
    expect(sanitizeTerminalText("x N\bN _\bf y")).to.equal(
      "x \x1b[1mN\x1b[22m \x1b[4mf\x1b[24m y",
    );
    expect(sanitizeTerminalText("B\bB_\bu")).to.equal(
      "\x1b[1mB\x1b[22m\x1b[4mu\x1b[24m",
    );
    // Souligné ET gras (`_⌫X⌫X`) : la frappe en trop n'ajoute rien.
    expect(sanitizeTerminalText("_\bX\bX")).to.equal("\x1b[4mX\x1b[24m");
    // Un autre retour arrière : retiré, les DEUX caractères restent visibles —
    // une ligne de journal ne masque rien.
    expect(sanitizeTerminalText("rm\b\bls")).to.equal("rmls");
    // Seul, en tête ou en fin : retiré, rien d'autre ne bouge.
    expect(sanitizeTerminalText("\bab\b")).to.equal("ab");
  });

  it("la VRAIE sortie de man hors terminal ne double aucune lettre", () => {
    // Octets constatés sur `MANPAGER=cat man nodefony.1` (groff et mandoc).
    const page =
      "N\bNA\bAM\bME\bE\n       n\bno\bod\bde\bef\bfo\bon\bny\by _\b[_\bC_\bO]";
    const plain = page
      .split("\n")
      .map(sanitizeTerminalText)
      .map((l) => l.replace(/\x1b\[[0-9;]*m/g, ""));
    expect(plain).to.deep.equal(["NAME", "       nodefony [CO]"]);
  });

  it("retire un hyperlien javascript:, garde son texte", () => {
    const evil = "\x1b]8;;javascript:alert(1)\x1b\\clic\x1b]8;;\x1b\\";
    expect(sanitizeTerminalText(evil)).to.equal("clic\x1b]8;;\x1b\\");
  });

  it("couleur et effacement de ligne reconnus au plus juste — rien de voisin ne passe (#896)", () => {
    const cases: Array<[string, string]> = [
      ["\x1b[m", "\x1b[m"],
      ["\x1b[38:2:1:2:3m", "\x1b[38:2:1:2:3m"],
      ["\x1b[1;31m", "\x1b[1;31m"],
      ["\x1b[K", "\x1b[K"],
      ["\x1b[0K", "\x1b[0K"],
      ["\x1b[2K", "\x1b[2K"],
      ["\x1b[3K", ""], // pas un effacement de ligne
      ["\x1b[12K", ""],
      ["\x1b[;K", ""],
      ["\x1b[<1m", ""], // `<` : paramètre CSI, mais pas de SGR
      ["\x1b[?25h", ""],
      ["\x1b[1 m", ""], // octet intermédiaire
    ];
    for (const [input, expected] of cases) {
      expect(
        sanitizeTerminalText(`a${input}b`),
        JSON.stringify(input),
      ).to.equal(`a${expected}b`);
    }
    // Coupée en fin de texte : `ESC [` part comme séquence à deux octets.
    expect(sanitizeTerminalText("a\x1b[31")).to.equal("a31");
    expect(sanitizeTerminalText("a\x1b[")).to.equal("a");
  });

  it("voie rapide : une tabulation seule, ou une séquence de curseur seule, ne passe pas telle quelle", () => {
    expect(sanitizeTerminalText("a\tb")).to.equal("a    b");
    expect(sanitizeTerminalText("\x1b[32mok\x1b[0m\x1b[2A")).to.equal(
      "\x1b[32mok\x1b[0m",
    );
    const clean = "\x1b[1mgras\x1b[22m et \x1b[K fin";
    expect(sanitizeTerminalText(clean)).to.equal(clean);
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
