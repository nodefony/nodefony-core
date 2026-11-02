/**
 * Gabarit d'un chemin de route lu hors du routeur (`runtime/routePath.ts`) :
 * les noms qu'il porte, sa forme simple, et son remplissage — dont les valeurs
 * qu'aucun encodage ne rend sûres.
 */
import { describe, it, expect } from "vitest";
import {
  fillRoutePath,
  isSimpleRouteTemplate,
  routePathParams,
} from "../runtime/routePath";

describe("routePath — gabarit d'un chemin de route", () => {
  it("routePathParams : les noms, dans l'ordre", () => {
    expect(routePathParams("/chat/messages/{id}/reactions/{emoji}")).toEqual([
      "id",
      "emoji",
    ]);
    expect(routePathParams("/chat/history")).toEqual([]);
  });

  it("isSimpleRouteTemplate : un `{nom}` par segment entier, rien d'autre", () => {
    for (const ok of ["/a/{id}", "/a/{id}/b/{slug}", "/a", "/{x}"]) {
      expect(isSimpleRouteTemplate(ok), ok).toBe(true);
    }
    for (const bad of [
      "/a/{id}(\\d+)",
      "/a/{slug}?",
      "/a/{name}.{format}",
      "/a/v{n}",
      "/a/{}",
    ]) {
      expect(isSimpleRouteTemplate(bad), bad).toBe(false);
    }
  });

  it("fillRoutePath : chaque valeur encodée pour tenir dans UN segment", () => {
    expect(fillRoutePath("/m/{id}", { id: 42 })).toBe("/m/42");
    expect(fillRoutePath("/m/{id}", { id: "a/b?c#d" })).toBe(
      "/m/a%2Fb%3Fc%23d",
    );
    expect(fillRoutePath("/m/{id}", { id: "%2e%2e" })).toBe("/m/%252e%252e");
    expect(fillRoutePath("/m/{a}/{b}", { a: "x", b: "y" })).toBe("/m/x/y");
  });

  it("fillRoutePath : refuse une variable manquante et les valeurs vide, `.`, `..`", () => {
    expect(() => fillRoutePath("/m/{id}", {})).toThrow(TypeError);
    expect(() => fillRoutePath("/m/{id}", undefined)).toThrow(
      /« id » manquant/,
    );
    expect(() => fillRoutePath("/m/{id}", { id: { x: 1 } })).toThrow(TypeError);
    for (const bad of ["", ".", ".."]) {
      expect(() => fillRoutePath("/m/{id}", { id: bad }), bad).toThrow(
        /un segment ne peut être vide/,
      );
    }
  });
});
