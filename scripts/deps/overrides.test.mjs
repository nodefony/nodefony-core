/**
 * `forcedByOverride` — une dépendance qu'un tiers déclare est-elle forcée par les
 * `overrides` de la racine ? Sans cette lecture, `deps:check` annonçait un
 * dédoublement que le dépôt avait déjà rendu impossible (vite sous Angular).
 */
import { describe, it, expect } from "vitest";
import { forcedByOverride } from "./lib/overrides.mjs";

describe("forcedByOverride — ce que la racine impose à un tiers", () => {
  const overrides = {
    "@angular/build": { vite: "$vite", "rolldown@^1": "$rolldown" },
    "lodash-es": "^4.18.1",
    "@scope/x@1": { y: { ".": "2.0.0" } },
    glob: { ".": "^14.0.2" },
  };

  it("forme imbriquée : le sous-arbre du parent seulement (vécu : vite sous @angular/build)", () => {
    expect(forcedByOverride(overrides, "@angular/build", "vite")).toBe("$vite");
    expect(forcedByOverride(overrides, "autre", "vite")).toBeNull();
  });
  it("une clé portant une plage se lit sur son NOM", () => {
    expect(forcedByOverride(overrides, "@angular/build", "rolldown")).toBe(
      "$rolldown",
    );
    expect(forcedByOverride(overrides, "@scope/x", "y")).toBe("2.0.0");
  });
  it("forme globale : vaut pour tout parent", () => {
    expect(forcedByOverride(overrides, "n-importe", "lodash-es")).toBe(
      "^4.18.1",
    );
    expect(forcedByOverride(overrides, "n-importe", "glob")).toBe("^14.0.2");
  });
  it("rien de déclaré → null, jamais un forçage supposé", () => {
    expect(forcedByOverride(undefined, "a", "b")).toBeNull();
    expect(forcedByOverride(overrides, "@angular/build", "semver")).toBeNull();
  });
});
