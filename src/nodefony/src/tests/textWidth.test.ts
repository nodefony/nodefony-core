/**
 * Largeur visible en colonnes (`runtime/textWidth.ts`) : la règle unique de
 * la barre d'état, du repli à la largeur et du curseur de l'invite.
 */
import { describe, it, expect } from "vitest";
import {
  fitToWidth,
  graphemeWidth,
  visibleWidth,
  wrapToWidth,
} from "../runtime/textWidth";
import { fitStatus } from "../service/dev/statusLine";

describe("visibleWidth", () => {
  it("compte les colonnes : large à 2, combinant à 0, contrôle à 0", () => {
    // ⚠ (sans VS16) 1 · espace 1 · 漢字 4 · espace 1 · 👍🏽 2
    expect(visibleWidth("⚠ 漢字 👍🏽")).to.equal(9);
    expect(visibleWidth("⚠️")).to.equal(2);
    expect(visibleWidth("é")).to.equal(1);
    expect(visibleWidth("🇫🇷")).to.equal(2);
    expect(visibleWidth("👨‍👩‍👧")).to.equal(2);
    expect(visibleWidth("ｈｅｌｌｏ")).to.equal(10);
    expect(visibleWidth("")).to.equal(0);
  });

  it("exclut couleurs, hyperliens OSC 8 et échappements tronqués", () => {
    expect(visibleWidth("\x1b[1;31mrouge\x1b[0m")).to.equal(5);
    const link = "\x1b]8;;https://example.com\x1b\\lien\x1b]8;;\x1b\\";
    expect(visibleWidth(link)).to.equal(4);
    expect(visibleWidth("\x1b]8;;file:///x\x07ok\x1b]8;;\x07")).to.equal(2);
    expect(visibleWidth("a\x1b")).to.equal(1);
  });

  it("graphemeWidth rend 0, 1 ou 2", () => {
    expect(graphemeWidth("a")).to.equal(1);
    expect(graphemeWidth("́")).to.equal(0);
    expect(graphemeWidth("‍")).to.equal(0);
    expect(graphemeWidth("字")).to.equal(2);
    expect(graphemeWidth("🔥")).to.equal(2);
  });
});

describe("visibleWidth — l'ASCII sans segmenteur, même résultat (#903)", () => {
  // La référence : chaque tranche sans séquence découpée ENTIÈRE en graphèmes,
  // ce que faisait visibleWidth avant de compter l'ASCII sans segmenteur.
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const reference = (text: string): number => {
    let width = 0;
    for (const part of text.split(/\x1b\[[0-9;]*m/)) {
      for (const { segment } of segmenter.segment(part)) {
        width += graphemeWidth(segment);
      }
    }
    return width;
  };
  // Les pièges : marque combinante, marque espaçante, liant, émoji, chinois,
  // drapeau, sélecteur, cabochon, préfixes (Cf et Lo), contrôles, couleur.
  const ALPHABET = [
    "a",
    "e",
    "#",
    "1",
    " ",
    "·",
    "✓",
    "█",
    "中",
    "😀",
    "🇫",
    "🇷",
    "́",
    "ः",
    "‍",
    "️",
    "⃣",
    "؀",
    "ൎ",
    "\r",
    "\n",
    "\t",
    "\x1b[31m",
    "\x1b[0m",
  ];

  it("rend la largeur du découpage entier sur 20 000 textes tirés au hasard", () => {
    // mulberry32 : entiers 32 bits exacts (`Math.imul`). Un générateur à
    // multiplication flottante dépasse 2^53 et ne tirait que 6 lettres sur 24.
    let seed = 903;
    const next = (): number => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return (t ^ (t >>> 14)) >>> 0;
    };
    const drawn = new Set<string>();
    for (let n = 0; n < 20_000; n++) {
      let text = "";
      const length = next() % 12;
      for (let k = 0; k < length; k++) {
        const letter = ALPHABET[next() % ALPHABET.length] ?? "";
        drawn.add(letter);
        text += letter;
      }
      expect(visibleWidth(text), JSON.stringify(text)).to.equal(
        reference(text),
      );
    }
    // Le tirage a couvert tout l'alphabet : sinon le test ne prouve rien.
    expect(drawn.size).to.equal(ALPHABET.length);
  });

  it("un préfixe se soude à l'ASCII qui le suit", () => {
    expect(visibleWidth("·ൎa")).to.equal(reference("·ൎa"));
    expect(visibleWidth("é中")).to.equal(3);
    expect(visibleWidth("cpu 3 % · elu 2 % ✓ prêt")).to.equal(24);
  });
});

describe("fitToWidth", () => {
  it("ne coupe jamais un caractère large en deux, et ne dépasse jamais", () => {
    const fitted = fitToWidth("漢字漢字漢字", 6);
    expect(visibleWidth(fitted)).to.be.at.most(6);
    expect(fitted.startsWith("漢字")).to.equal(true);
    expect(fitted).to.match(/…\x1b\[0m$/);
  });

  it("rend le texte tel quel quand il tient", () => {
    expect(fitToWidth("\x1b[32mok\x1b[0m", 2)).to.equal("\x1b[32mok\x1b[0m");
  });
});

describe("fitStatus — en colonnes, plus en unités de code", () => {
  it("une ligne d'idéogrammes tient dans columns - 1 colonnes", () => {
    // Un idéogramme = 1 unité de code, 2 colonnes : compter les unités
    // laisserait passer 38 idéogrammes, soit 76 colonnes sur 40.
    const fitted = fitStatus("漢字".repeat(40), 40);
    expect(visibleWidth(fitted)).to.be.at.most(39);
    expect(visibleWidth(fitted)).to.be.at.least(37);
  });

  it("une ligne d'émojis aussi", () => {
    const fitted = fitStatus("👍🏽".repeat(40), 40);
    expect(visibleWidth(fitted)).to.be.at.most(39);
  });
});

describe("wrapToWidth", () => {
  it("replie sans dépasser, sans couper un graphème", () => {
    const lines = wrapToWidth("ab漢字cd👍🏽e", 3);
    for (const l of lines) expect(visibleWidth(l)).to.be.at.most(3);
    expect(lines.join("").replace(/\x1b\[[0-9;]*m/g, "")).to.equal(
      "ab漢字cd👍🏽e",
    );
  });

  it("referme la couleur en fin de ligne et la rouvre en tête de la suivante", () => {
    const lines = wrapToWidth("\x1b[31mabcdef\x1b[0m", 3);
    expect(lines).to.deep.equal(["\x1b[31mabc\x1b[0m", "\x1b[31mdef\x1b[0m"]);
  });

  it("une ligne vide reste une ligne", () => {
    expect(wrapToWidth("", 10)).to.deep.equal([""]);
  });
});

/**
 * Un hyperlien OSC 8 resté OUVERT met « dans le lien » tout ce que le
 * terminal écrit ensuite — y compris l'image suivante et l'invite du shell.
 * Une ligne repliée ou coupée referme donc le sien, comme ses couleurs.
 */
describe("hyperliens OSC 8 — refermés par ligne", () => {
  const OPEN = "\x1b]8;;https://nodefony.net/doc\x1b\\";
  const CLOSE = "\x1b]8;;\x1b\\";
  const LINK = /\x1b\]8;[^;\x07\x1b]*;([^\x07\x1b]*)(?:\x1b\\|\x07)/g;
  /** Le dernier OSC 8 de la ligne ouvre-t-il un lien ? */
  const leftOpen = (line: string): boolean => {
    let open = false;
    for (const m of line.matchAll(LINK)) open = (m[1] ?? "") !== "";
    return open;
  };

  it("wrapToWidth : chaque ligne repliée referme le lien et la suivante le rouvre", () => {
    const lines = wrapToWidth(`${OPEN}${"a".repeat(30)}${CLOSE} fin`, 10);
    expect(lines.length).to.be.greaterThan(2);
    for (const line of lines) expect(leftOpen(line), line).to.equal(false);
    expect(lines[1]?.startsWith(OPEN)).to.equal(true);
  });

  it("fitToWidth : une ligne coupée dans un lien le referme", () => {
    const line = fitToWidth(`${OPEN}${"a".repeat(30)}${CLOSE}`, 10);
    expect(leftOpen(line)).to.equal(false);
  });
});
