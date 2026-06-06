/**
 * Unit — géométrie du bureau libre (`frontend/src/workspace/grid.ts`).
 *
 * Bureau LIBRE (chevauchement autorisé) → on teste l'**aimantation** (snap), les
 * **bornes** (clamp) et le **pavage à la demande** (autoTile = « Ranger » +
 * migration) : 0 chevauchement horizontal dans une rangée, retour à la ligne,
 * ordre conservé. Logique pure → déterministe.
 */
import { describe, it } from "vitest";
import { expect } from "chai";
import {
  snap,
  clamp,
  autoTile,
  type TileInput,
} from "../../../frontend/src/workspace/grid";

describe("grid — snap", () => {
  it("arrondit au pas le plus proche", () => {
    expect(snap(13, 8)).to.equal(16);
    expect(snap(11, 8)).to.equal(8);
  });
  it("pas ≤ 0 → valeur inchangée", () => {
    expect(snap(0.137, 0)).to.equal(0.137);
  });
});

describe("grid — clamp", () => {
  it("borne dans [lo, hi]", () => {
    expect(clamp(-1, 0, 1)).to.equal(0);
    expect(clamp(2, 0, 1)).to.equal(1);
    expect(clamp(0.5, 0, 1)).to.equal(0.5);
  });
});

describe("grid — autoTile (Ranger / migration)", () => {
  it("range sur une rangée tant que ça tient (y = 0)", () => {
    const items: TileInput[] = [
      { id: "a", w: 0.3, h: 200 },
      { id: "b", w: 0.3, h: 200 },
    ];
    const out = autoTile(items);
    expect(out.every((o) => o.y === 0)).to.equal(true);
    expect(out[0].x).to.equal(0);
    expect(out[1].x).to.be.greaterThan(out[0].x);
  });

  it("retour à la ligne quand la largeur dépasse 1", () => {
    const items: TileInput[] = [
      { id: "a", w: 0.6, h: 100 },
      { id: "b", w: 0.6, h: 100 },
    ];
    const out = autoTile(items);
    expect(out[0].y).to.equal(0);
    expect(out[1].y).to.be.greaterThan(0);
    expect(out[1].x).to.equal(0);
  });

  it("0 chevauchement horizontal dans une rangée + ordre conservé", () => {
    const items: TileInput[] = [
      { id: "a", w: 0.25, h: 100 },
      { id: "b", w: 0.25, h: 100 },
      { id: "c", w: 0.25, h: 100 },
    ];
    const out = autoTile(items);
    expect(out.map((o) => o.id)).to.deep.equal(["a", "b", "c"]);
    for (let i = 1; i < out.length; i++)
      if (out[i].y === out[i - 1].y)
        expect(out[i].x).to.be.at.least(out[i - 1].x + out[i - 1].w);
  });

  it("hauteur de rangée = la plus haute fenêtre de la rangée", () => {
    const items: TileInput[] = [
      { id: "a", w: 0.4, h: 300 },
      { id: "b", w: 0.4, h: 100 },
      { id: "c", w: 0.4, h: 100 },
    ];
    const out = autoTile(items);
    expect(out[2].y).to.be.at.least(300);
  });
});
