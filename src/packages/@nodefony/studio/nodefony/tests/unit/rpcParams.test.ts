/**
 * Les paramètres d'une action temps réel arrivent du réseau : `rpcParam` et
 * `readAnswers` lisent ce qui est réellement arrivé, sans croire le type `in`
 * du contrat.
 */
import { describe, expect, it } from "vitest";
import { readAnswers, rpcParam } from "../../src/rpcParams";

describe("rpcParam", () => {
  it("lit un champ propre d'une charge objet", () => {
    expect(rpcParam({ id: "a1" }, "id")).toBe("a1");
  });

  it("rend undefined pour une charge absente, scalaire ou sans le champ", () => {
    expect(rpcParam(undefined, "id")).toBeUndefined();
    expect(rpcParam(null, "id")).toBeUndefined();
    expect(rpcParam("id", "length")).toBeUndefined();
    expect(rpcParam({}, "id")).toBeUndefined();
  });

  it("ignore un champ hérité : un paramètre est une propriété PROPRE", () => {
    expect(rpcParam({}, "constructor")).toBeUndefined();
    expect(rpcParam(Object.create({ id: "hérité" }), "id")).toBeUndefined();
  });
});

describe("readAnswers", () => {
  it("garde texte, case et liste de textes", () => {
    expect(
      readAnswers({ name: "blog", force: true, tags: ["a", "b"] }),
    ).toEqual({ name: "blog", force: true, tags: ["a", "b"] });
  });

  it("jette toute autre forme de valeur", () => {
    expect(
      readAnswers({
        n: 3,
        nul: null,
        obj: { x: 1 },
        mixed: ["a", 2],
        fn: "ok",
      }),
    ).toEqual({ fn: "ok" });
  });

  it("rend un objet vide pour une charge qui n'est pas un objet", () => {
    expect(readAnswers(undefined)).toEqual({});
    expect(readAnswers("name=blog")).toEqual({});
    expect(readAnswers(["blog"])).toEqual({});
  });

  it("n'emporte aucune clé héritée", () => {
    expect(readAnswers(Object.create({ name: "hérité" }))).toEqual({});
  });
});
