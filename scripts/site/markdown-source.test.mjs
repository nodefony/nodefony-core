import { describe, expect, it } from "vitest";
import { sansCommentaires } from "./lib/markdown-source.mjs";

describe("sansCommentaires", () => {
  it("retire la consigne au formateur placée devant un tableau", () => {
    const src = "Texte\n\n<!-- prettier-ignore -->\n| a | b |\n| - | - |";
    expect(sansCommentaires(src)).toBe("Texte\n\n| a | b |\n| - | - |");
  });

  it("garde un commentaire montré dans un bloc de code", () => {
    const src =
      "```html\n<!-- nodefony:start -->\n```\n<!-- x -->\n~~~\n<!-- y -->\n~~~";
    expect(sansCommentaires(src)).toBe(
      "```html\n<!-- nodefony:start -->\n```\n~~~\n<!-- y -->\n~~~",
    );
  });

  it("garde un commentaire au milieu d'une phrase (il n'occupe pas la ligne)", () => {
    expect(sansCommentaires("avant <!-- note --> après")).toBe(
      "avant <!-- note --> après",
    );
  });
});
