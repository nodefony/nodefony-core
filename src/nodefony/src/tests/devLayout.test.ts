/**
 * La mise en page du superviseur (`service/dev/devLayout.ts`) : régions
 * disjointes, priorité par le bas, équivalence avec les trois zones d'avant.
 */
import { describe, it, expect } from "vitest";
import {
  layout,
  type ILayoutState,
  type IRegion,
  type TabsPlacement,
} from "../service/dev/devLayout";

const state = (over: Partial<ILayoutState> = {}): ILayoutState => ({
  tabs: "none",
  band: 0,
  prompt: 1,
  bar: 1,
  ...over,
});
const kinds = (regions: IRegion[]) => regions.map((r) => r.kind);
const heightOf = (regions: IRegion[], kind: IRegion["kind"]) =>
  regions.find((r) => r.kind === kind)?.height ?? 0;

describe("layout — équivalence avec l'écran d'avant", () => {
  it("sans onglets ni bande : la vue, l'invite, la barre, et rien d'autre", () => {
    const regions = layout({ columns: 120, rows: 30 }, state({ bar: 2 }));
    expect(regions).toEqual([
      { kind: "view", row: 0, column: 0, width: 119, height: 27 },
      { kind: "prompt", row: 27, column: 0, width: 119, height: 1 },
      { kind: "bar", row: 28, column: 0, width: 119, height: 2 },
    ]);
  });

  it("la dernière colonne reste libre, comme dans renderFrame", () => {
    for (const r of layout(
      { columns: 80, rows: 10 },
      state({ tabs: "bottom", band: 2 }),
    )) {
      expect(r.column + r.width).toBe(79);
    }
  });
});

describe("layout — placement des onglets", () => {
  it("en bas : vue, marge, onglets, bande, invite, barre — le bloc de saisie se suit", () => {
    const regions = layout(
      { columns: 100, rows: 30 },
      state({ tabs: "bottom", band: 4 }),
    );
    expect(kinds(regions)).toEqual([
      "view",
      "gap",
      "tabs",
      "band",
      "prompt",
      "bar",
    ]);
    expect(heightOf(regions, "tabs")).toBe(1);
    expect(heightOf(regions, "gap")).toBe(1);
  });

  it("en haut : la ligne d'onglets ouvre l'écran", () => {
    const regions = layout({ columns: 100, rows: 30 }, state({ tabs: "top" }));
    expect(kinds(regions)).toEqual(["tabs", "gap", "view", "prompt", "bar"]);
    expect(regions[0]?.row).toBe(0);
  });

  it("sans ligne d'onglets, aucune marge : la vue garde toute sa hauteur", () => {
    const regions = layout({ columns: 100, rows: 30 }, state({ band: 4 }));
    expect(kinds(regions)).not.toContain("gap");
  });
});

describe("layout — hauteur qui manque", () => {
  it("la bande ne prend jamais plus d'un tiers de l'écran", () => {
    expect(
      heightOf(layout({ columns: 80, rows: 30 }, state({ band: 25 })), "band"),
    ).toBe(10);
    expect(
      heightOf(layout({ columns: 80, rows: 7 }, state({ band: 5 })), "band"),
    ).toBe(2);
  });

  it("priorité par le bas : barre, invite, bande, onglets ; la vue prend le reste", () => {
    const tiny = layout(
      { columns: 80, rows: 2 },
      state({ tabs: "bottom", band: 3 }),
    );
    expect(kinds(tiny)).toEqual(["prompt", "bar"]);
    // Une ligne pour deux : la bande (ouverte, donc demandée) passe avant les onglets.
    const three = layout(
      { columns: 80, rows: 3 },
      state({ tabs: "bottom", band: 3 }),
    );
    expect(kinds(three)).toEqual(["band", "prompt", "bar"]);
    const four = layout(
      { columns: 80, rows: 4 },
      state({ tabs: "bottom", band: 3 }),
    );
    expect(kinds(four)).toEqual(["tabs", "band", "prompt", "bar"]);
    // La marge cède avant la vue : elle n'existe que si la vue garde une ligne.
    const room = (rows: number) =>
      kinds(layout({ columns: 80, rows }, state({ tabs: "bottom" })));
    expect(room(4)).toEqual(["view", "tabs", "prompt", "bar"]);
    expect(room(5)).toEqual(["view", "gap", "tabs", "prompt", "bar"]);
    const one = layout(
      { columns: 80, rows: 1 },
      state({ tabs: "top", band: 3 }),
    );
    expect(kinds(one)).toEqual(["bar"]);
  });

  it("un terminal de taille nulle ne rend rien, sans hauteur négative", () => {
    expect(
      layout({ columns: 0, rows: 0 }, state({ tabs: "bottom", band: 3 })),
    ).toEqual([]);
  });
});

describe("layout — invariants sur toutes les tailles", () => {
  const placements: TabsPlacement[] = ["none", "top", "bottom"];
  it("régions disjointes, contiguës, qui couvrent exactement l'écran", () => {
    for (const tabs of placements) {
      for (const band of [0, 1, 5, 40]) {
        for (let rows = 0; rows <= 40; rows++) {
          for (const columns of [1, 2, 80]) {
            const regions = layout(
              { columns, rows },
              state({ tabs, band, bar: 2 }),
            );
            let next = 0;
            for (const r of regions) {
              expect(r.row).toBe(next);
              expect(r.height).toBeGreaterThan(0);
              expect(r.width).toBe(Math.max(1, columns - 1));
              next += r.height;
            }
            expect(next).toBe(rows);
          }
        }
      }
    }
  });
});
