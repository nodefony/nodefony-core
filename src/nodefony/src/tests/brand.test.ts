/**
 * La bannière du terminal : chaque disposition, sans terminal. Ce qui compte
 * ici n'est pas le dessin mais ce qui le rendrait faux chez quelqu'un — une
 * ligne plus large que son terminal, une couleur malgré NO_COLOR, un caractère
 * que la console Windows classique ne sait pas afficher.
 */
import { describe, it } from "vitest";
import { assert } from "chai";
import {
  BRAND_LOGO,
  BRAND_LOGO_ASCII,
  BRAND_LOGO_ASCII_COLORS,
  BRAND_LOGO_COLORS,
  BRAND_WORDMARK,
  renderBrand,
  resolveBrandCharset,
  type IBrandOptions,
} from "../cli/brand";

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const widest = (s: string) =>
  Math.max(
    ...strip(s)
      .split("\n")
      .map((l) => Array.from(l).length),
  );

const base: IBrandOptions = {
  version: "10.0.0",
  rows: [
    { label: "app", value: "demo · development" },
    { label: "node", value: "v26.10.0 · linux · pid 1" },
  ],
  columns: 120,
  color: false,
  charset: "unicode",
};

describe("renderBrand", () => {
  it("ne dépasse jamais la largeur du terminal, à toute largeur", () => {
    for (let columns = 20; columns <= 160; columns++) {
      const out = renderBrand({ ...base, columns });
      assert.isAtMost(widest(out), columns, `${columns} colonnes`);
    }
  });

  it("large : logo, mot et encart sur les mêmes lignes", () => {
    const lines = strip(renderBrand(base)).split("\n");
    const titled = lines.find((l) => l.includes("Nodefony 10.0.0"));
    assert.ok(titled, "titre absent");
    assert.include(titled, "_ __", "le titre n'est pas à côté du mot");
  });

  it("étroit : ni logo ni mot, le seul encart", () => {
    const out = strip(renderBrand({ ...base, columns: 40 }));
    assert.notInclude(out, BRAND_WORDMARK[2]!.trim());
    assert.include(out, "Nodefony 10.0.0");
  });

  it("sans couleur : aucune séquence d'échappement", () => {
    assert.notMatch(renderBrand(base), /\x1b\[/);
  });

  it("avec couleur : les trois arcs du logo portent bleu, vert et bleu ciel", () => {
    const out = renderBrand({ ...base, color: true });
    for (const code of ["\x1b[34m", "\x1b[32m", "\x1b[36m"])
      assert.include(out, code);
  });

  it("ascii : seulement des caractères ASCII imprimables", () => {
    const out = strip(renderBrand({ ...base, charset: "ascii", color: true }));
    // L'encart reprend les valeurs données : on ne juge que le dessin.
    const art = out
      .split("\n")
      .map(
        (l) =>
          l.split("   Nodefony")[0]!.split("   app")[0]!.split("   node")[0]!,
      );
    for (const line of art) assert.match(line, /^[\x20-\x7e]*$/, line);
  });
});

describe("constantes du dessin", () => {
  it("chaque ligne du logo a sa ligne de couleurs, de même longueur", () => {
    for (const [logo, colors] of [
      [BRAND_LOGO, BRAND_LOGO_COLORS],
      [BRAND_LOGO_ASCII, BRAND_LOGO_ASCII_COLORS],
    ] as const) {
      assert.lengthOf(colors, logo.length);
      logo.forEach((line, i) =>
        assert.lengthOf(
          Array.from(colors[i]!),
          Array.from(line).length,
          `ligne ${i}`,
        ),
      );
    }
  });

  it("logo et mot ont la même hauteur et des lignes de largeur égale", () => {
    assert.lengthOf(BRAND_WORDMARK, BRAND_LOGO.length);
    for (const set of [BRAND_LOGO, BRAND_LOGO_ASCII, BRAND_WORDMARK]) {
      const widths = new Set(set.map((l) => Array.from(l).length));
      assert.strictEqual(widths.size, 1, set[0]);
    }
  });
});

describe("resolveBrandCharset", () => {
  it("braille hors Windows, ASCII sur la console Windows classique", () => {
    assert.strictEqual(resolveBrandCharset("darwin", {}), "unicode");
    assert.strictEqual(resolveBrandCharset("linux", {}), "unicode");
    assert.strictEqual(resolveBrandCharset("win32", {}), "ascii");
  });

  it("braille sous Windows Terminal et dans un terminal intégré qui se déclare", () => {
    assert.strictEqual(
      resolveBrandCharset("win32", { WT_SESSION: "x" }),
      "unicode",
    );
    assert.strictEqual(
      resolveBrandCharset("win32", { TERM_PROGRAM: "vscode" }),
      "unicode",
    );
  });

  it("NF_BANNER_ASCII=1 force l'ASCII partout", () => {
    assert.strictEqual(
      resolveBrandCharset("darwin", { NF_BANNER_ASCII: "1" }),
      "ascii",
    );
  });
});
