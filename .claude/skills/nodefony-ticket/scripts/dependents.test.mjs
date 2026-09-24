/**
 * `dependentsOf` — qui relire avant de fermer un ticket.
 */
import { describe, it, expect } from "vitest";
import { dependentsOf } from "./dependents.mjs";

const t = (number, body) => ({ number, title: `t${number}`, body });

describe("dependentsOf", () => {
  it("distingue une dépendance DÉCLARÉE d'une simple mention", () => {
    const { declared, mentioned } = dependentsOf(
      [
        t(1, "**Dépend de** : #175"),
        t(2, "voir #175 pour le contexte"),
        t(3, "Depend de #12, #175"),
      ],
      175,
    );
    expect(declared.map((x) => x.number)).toEqual([1, 3]);
    expect(mentioned.map((x) => x.number)).toEqual([2]);
  });
  it("#17 ne cite PAS #175, ni #1750 — la borne de nombre tient", () => {
    const { declared, mentioned } = dependentsOf(
      [t(1, "Dépend de : #1750"), t(2, "cf #17")],
      175,
    );
    expect(declared.concat(mentioned)).toEqual([]);
    expect(dependentsOf([t(2, "Dépend de #17.")], 17).declared).toHaveLength(1);
  });
  it("une ancre d'URL (`pull/175#175`) ou un chemin n'est pas une citation", () => {
    expect(dependentsOf([t(1, "src/a#175")], 175).mentioned).toEqual([]);
  });
  it("le ticket lui-même et un corps vide sont ignorés", () => {
    expect(dependentsOf([t(175, "#175"), t(2, null)], 175)).toEqual({
      declared: [],
      mentioned: [],
    });
  });
});
