import { describe, it, expect } from "vitest";
import { isSafeSlug, pathToSlug } from "../../src/slug";

describe("isSafeSlug", () => {
  it("accepte un slug racine valide", () => {
    expect(isSafeSlug("root~realtime~socket~01-fan-out")).toBe(true);
  });
  it("accepte un slug module valide", () => {
    expect(isSafeSlug("mod~http~index")).toBe(true);
  });
  it("rejette la chaîne vide", () => {
    expect(isSafeSlug("")).toBe(false);
  });
  it("rejette un slug trop long (> 512)", () => {
    expect(isSafeSlug("a".repeat(513))).toBe(false);
  });
  it("rejette un octet nul", () => {
    expect(isSafeSlug("root~a\0b")).toBe(false);
  });
  it("rejette un séparateur de chemin / ou \\", () => {
    expect(isSafeSlug("root/a")).toBe(false);
    expect(isSafeSlug("root\\a")).toBe(false);
  });
  it("rejette un segment de traversée ..", () => {
    expect(isSafeSlug("root~..~secret")).toBe(false);
    expect(isSafeSlug("..")).toBe(false);
  });
  it("rejette les caractères hors charset", () => {
    expect(isSafeSlug("root a")).toBe(false); // espace
    expect(isSafeSlug("root~@x")).toBe(false); // @
    expect(isSafeSlug("root~%2e%2e")).toBe(false); // % (tentative d'encodage)
  });
});

describe("pathToSlug", () => {
  it("racine : retire .md et remplace / par ~", () => {
    expect(pathToSlug({ kind: "root" }, "realtime/socket/01-x.md")).toBe(
      "root~realtime~socket~01-x",
    );
  });
  it("module : retire le scope @nodefony/", () => {
    expect(
      pathToSlug({ kind: "module", module: "@nodefony/http" }, "index.md"),
    ).toBe("mod~http~index");
  });
  it("normalise les backslashes Windows", () => {
    expect(pathToSlug({ kind: "root" }, "a\\b.md")).toBe("root~a~b");
  });
  it("le slug produit est toujours sûr (même nom de module exotique)", () => {
    const s = pathToSlug(
      { kind: "module", module: "@scope/weird name!" },
      "x/y.md",
    );
    expect(isSafeSlug(s)).toBe(true);
  });
});
