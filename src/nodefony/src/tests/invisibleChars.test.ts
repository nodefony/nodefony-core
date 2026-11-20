import { describe, expect, it } from "vitest";
import { describeInvisibleChars } from "../cli/scaffold/invisibleChars";
import { resolveAnswers } from "../cli/scaffold/engine";
import { getScaffoldSpec } from "../cli/scaffold/spec";

const [appSpec] = getScaffoldSpec("app");
const caps = { hasCheckout: false };

describe("describeInvisibleChars — nommer ce que le terminal ne montre pas", () => {
  it("nomme l'espace insécable d'un copier-coller, avec sa position", () => {
    const note = describeInvisibleChars("brice-app\u00a0");
    expect(note).toContain("U+00A0 (espace insécable) en position 10");
    expect(note).toContain("copier-coller");
  });

  it("les nomme tous, au pluriel", () => {
    const note = describeInvisibleChars("\ufeffa\u200bb");
    expect(note).toContain("des caractères INVISIBLES");
    expect(note).toContain("U+FEFF");
    expect(note).toContain("U+200B (espace sans chasse) en position 3");
  });

  it("se tait sur une valeur propre — un espace ordinaire se voit", () => {
    expect(describeInvisibleChars("brice-app")).toBeNull();
    expect(describeInvisibleChars("brice app")).toBeNull();
  });
});

describe("resolveAnswers — le refus d'un nom nomme le caractère invisible", () => {
  it("« brice-app » + U+00A0 : refusé, ET le message dit pourquoi", () => {
    expect(() =>
      resolveAnswers(appSpec!, { name: "brice-app\u00a0" }, caps),
    ).toThrow(/name invalide[\s\S]*U\+00A0 \(espace insécable\)/u);
  });

  it("un nom fautif sans caractère invisible garde son message seul", () => {
    expect(() => resolveAnswers(appSpec!, { name: "Brice_App" }, caps)).toThrow(
      /^name invalide « Brice_App » — kebab-case attendu[^\n]*$/u,
    );
  });
});
