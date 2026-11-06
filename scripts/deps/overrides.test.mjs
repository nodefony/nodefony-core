/**
 * `forcedByOverride` — une dépendance qu'un tiers déclare est-elle forcée par les
 * `overrides` de la racine ? Sans cette lecture, `deps:check` annonçait un
 * dédoublement que le dépôt avait déjà rendu impossible (vite sous Angular).
 * `overrideBreaches` — un override pousse-t-il un tiers hors de sa plage ?
 * Vécu : rolldown 1.3 forcé sous vite (`~1.2.16`) rendait le bundle de Studio
 * invalide ; `deps:gate` refuse désormais ce forçage sans motif inscrit.
 */
import { describe, it, expect } from "vitest";
import { forcedByOverride, overrideBreaches } from "./lib/overrides.mjs";

describe("overrideBreaches — un override ne pousse pas un tiers hors de sa plage", () => {
  const installed = {
    vite: { version: "8.3.6", deps: { rolldown: "~1.2.16" } },
    "@angular/build": {
      version: "22.2.6",
      deps: { vite: "8.3.5", vitest: "^4.0.8 || ^5.0.0" },
    },
    "@sentry/bundler-plugins": {
      version: "11.10.0",
      deps: { glob: "^13.0.6" },
    },
  };
  const roots = { rolldown: "1.3.0", vite: "8.3.6", vitest: "5.1.0" };
  const read = {
    rootVersion: (n) => roots[n] ?? null,
    declared: (p) => installed[p] ?? null,
  };
  const verdicts = (ov, acc = {}) =>
    Object.fromEntries(
      overrideBreaches(ov, read, acc).map((b) => [b.key, b.verdict]),
    );

  it("vécu : rolldown 1.3 forcé sous vite (~1.2.16) → HORS-PLAGE, la garde rougit", () => {
    expect(verdicts({ vite: { rolldown: "$rolldown" } })).toEqual({
      "vite>rolldown": "HORS-PLAGE",
    });
  });
  it("un simple correctif hors d'un pin exact est accepté d'office (vite 8.3.6 sous Angular qui épingle 8.3.5)", () => {
    expect(verdicts({ "@angular/build": { vite: "$vite" } })).toEqual({
      "@angular/build>vite": "correctif",
    });
  });
  it("dans la plage → rien : l'override dédoublonne, c'est sain", () => {
    expect(verdicts({ "@angular/build": { vitest: "$vitest" } })).toEqual({});
  });
  it("une majeure franchie passe seulement inscrite, avec son motif", () => {
    const ov = { "@sentry/bundler-plugins": { glob: "^14.0.2" } };
    expect(verdicts(ov)).toEqual({
      "@sentry/bundler-plugins>glob": "HORS-PLAGE",
    });
    const [b] = overrideBreaches(ov, read, {
      "@sentry/bundler-plugins>glob": "sécurité",
    });
    expect([b.verdict, b.reason]).toEqual(["accepté", "sécurité"]);
  });
  it("le parent ne déclare plus la dépendance → MORT", () => {
    expect(verdicts({ vite: { esbuild: "^0.25.0" } })).toEqual({
      "vite>esbuild": "MORT",
    });
  });
  it("une exception qui ne couvre plus rien → EXCEPTION-SANS-OBJET (le tiers a rattrapé : la retirer)", () => {
    expect(verdicts({}, { "vite>rolldown": "en attendant vite 9" })).toEqual({
      "vite>rolldown": "EXCEPTION-SANS-OBJET",
    });
  });
  it("parent non installé → rien à confronter, jamais un verdict supposé", () => {
    expect(verdicts({ absent: { x: "1.0.0" } })).toEqual({});
    expect(verdicts({}, { "absent>x": "motif" })).toEqual({});
  });
});

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
