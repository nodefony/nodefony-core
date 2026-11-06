/**
 * Constat des dépendances déclarées que l'amont a dépréciées — vécu :
 * `@types/figlet@1.12.0`, paquet vide que rien ne signalait.
 */
import { describe, it, expect } from "vitest";
import {
  deprecatedInstalled,
  deprecatedVersionsOf,
} from "./lib/deprecations.mjs";

describe("deprecatedVersionsOf — le document abrégé du registre", () => {
  it("rend les seules versions dépréciées, avec leur message", () => {
    expect(
      deprecatedVersionsOf({
        versions: {
          "1.7.0": {},
          "1.12.0": { deprecated: "stub — figlet a ses types" },
          "1.13.0": { deprecated: "" },
        },
      }),
    ).toEqual({ "1.12.0": "stub — figlet a ses types" });
  });
  it("aucune → null (pas d'allocation pour les 1 000 paquets sains)", () => {
    expect(deprecatedVersionsOf({ versions: { "1.0.0": {} } })).toBeNull();
    expect(deprecatedVersionsOf(null)).toBeNull();
  });
});

describe("deprecatedInstalled — la version AU VERROU fait foi", () => {
  const deprecated = new Map([
    ["@types/figlet", { "1.12.0": "stub" }],
    ["vieux", { "0.1.0": "abandonné" }],
  ]);
  const lock = new Map([
    ["@types/figlet", ["1.12.0"]],
    ["vieux", ["0.2.0"]],
  ]);
  const versionsOf = (n) => lock.get(n) ?? [];

  it("une version installée dépréciée est nommée", () => {
    expect(
      deprecatedInstalled(["@types/figlet", "vieux"], versionsOf, deprecated),
    ).toEqual([{ name: "@types/figlet", version: "1.12.0", message: "stub" }]);
  });
  it("une version dépréciée NON installée ne compte pas", () => {
    expect(deprecatedInstalled(["vieux"], versionsOf, deprecated)).toEqual([]);
  });
  it("un paquet non déclaré n'est pas relevé", () => {
    expect(deprecatedInstalled([], versionsOf, deprecated)).toEqual([]);
  });
});
