/**
 * Unit — le DÉTAIL d'un refus de canal n'est dit qu'HORS production.
 *
 * `RealtimeDeniedReason` est fermé et générique : `forbidden` ne distingue pas
 * un rôle insuffisant d'un plancher de plateforme clos, et c'est ce qui
 * l'empêche d'être un oracle. Le développeur, lui, paie cette prudence — il
 * reçoit un refus qu'il ne sait pas lire. D'où ce détail, et d'où sa règle :
 * la phrase qui aide en développement est exactement celle qui renseignerait
 * un attaquant en production.
 *
 * Isolée et éprouvée dans les DEUX sens pour la même raison que `welcomeEnv` :
 * noyée dans la composition du refus, son inversion ne casserait aucun test.
 */
import { describe, it, expect } from "vitest";
import { deniedDetail } from "../../src/server/deniedDetail";

describe("realtime:denied — le détail du refus", () => {
  it("est dit en développement : c'est là qu'on cherche pourquoi ça refuse", () => {
    expect(deniedDetail("development", "rôle insuffisant")).toEqual({
      detail: "rôle insuffisant",
    });
  });

  it("est dit dans tout mode qui n'est pas la production (staging, banc)", () => {
    expect(deniedDetail("staging", "aucun producteur")).toEqual({
      detail: "aucun producteur",
    });
  });

  it("est ABSENT en production — ce serait l'oracle que `reason` refuse d'être", () => {
    expect(deniedDetail("production", "rôle insuffisant")).toEqual({});
  });

  it("est ABSENT quand le mode est inconnu — une absence vaut production", () => {
    // Un kernel non résolu ne doit pas ouvrir le détail d'une politique par
    // accident : même règle, même sens de défaut que `welcomeEnv`.
    expect(deniedDetail(undefined, "rôle insuffisant")).toEqual({});
    expect(deniedDetail(null, "rôle insuffisant")).toEqual({});
    expect(deniedDetail("", "rôle insuffisant")).toEqual({});
  });
});
