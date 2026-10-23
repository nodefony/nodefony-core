import { describe, expect, it } from "vitest";
import { markdownTableCell } from "./env-reference.ts";

describe("markdownTableCell — une cellule de tableau GFM qui ne se coupe pas", () => {
  it("échappe la barre et le chevron hors code", () => {
    expect(markdownTableCell("a | b <x>")).toBe("a \\| b \\<x>");
  });

  it("échappe l'antislash AVANT la barre : `a\\|b` ne libère pas la barre", () => {
    // Sans l'antislash échappé, `a\|b` devient `a\\|b` : la barre redevient
    // nue et coupe la cellule en deux.
    expect(markdownTableCell("a\\|b")).toBe("a\\\\\\|b");
  });

  it("dans un segment de code, n'échappe que la barre", () => {
    expect(markdownTableCell("voir `C:\\x | <y>` ici")).toBe(
      "voir `C:\\x \\| <y>` ici",
    );
  });

  it("met la cellule sur une ligne", () => {
    expect(markdownTableCell("un\n  deux")).toBe("un deux");
  });
});
