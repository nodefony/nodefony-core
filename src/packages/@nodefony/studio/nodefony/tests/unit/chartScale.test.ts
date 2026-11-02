/// <reference types="node" />
/**
 * Unit — échelle verticale des mini-graphes (anti-saut).
 *
 * Le défaut corrigé : le plafond était recalculé à chaque point (`max × 1,15`) ;
 * un pic qui entrait ou sortait de la fenêtre faisait sauter toute la courbe
 * verticalement. Le plafond est désormais rond et à hystérésis.
 */
import { describe, it, expect } from "vitest";
import { niceCeil, stableTop } from "../../../frontend/src/utils/chartScale";

describe("plafond rond", () => {
  it("rend 1, 2, 2,5 ou 5 × 10ⁿ, jamais en dessous de la valeur", () => {
    expect(niceCeil(0.7)).toBe(1);
    expect(niceCeil(1)).toBe(1);
    expect(niceCeil(1.3)).toBe(2);
    expect(niceCeil(2.2)).toBe(2.5);
    expect(niceCeil(3)).toBe(5);
    expect(niceCeil(7)).toBe(10);
    expect(niceCeil(1234)).toBe(2000);
    expect(niceCeil(0)).toBe(1);
    expect(niceCeil(-5)).toBe(1);
  });
});

describe("échelle à hystérésis", () => {
  it("monte dès qu'une valeur dépasse, ne redescend que sous la moitié", () => {
    let top = stableTop(null, 40); // 46 → 50
    expect(top).toBe(50);
    top = stableTop(top, 30); // 34,5 → 50 : on garde (pas de saut)
    expect(top).toBe(50);
    top = stableTop(top, 60); // 69 → 100 : monte
    expect(top).toBe(100);
    top = stableTop(top, 45); // 51,75 → 100 : on garde
    expect(top).toBe(100);
    top = stableTop(top, 20); // 23 → 25 < 50 : redescend
    expect(top).toBe(25);
  });

  it("une série bruitée autour d'une valeur ne change plus l'échelle à chaque point", () => {
    // toutes sous 50 / 1,15 ≈ 43,5 : le plafond rond 50 tient
    const serie = [38, 41, 39, 43, 40, 37, 42, 43, 39, 41];
    let top: number | null = null;
    const changes = new Set<number>();
    for (const v of serie) {
      top = stableTop(top, v);
      changes.add(top);
    }
    expect([...changes]).toEqual([50]);
  });
});
