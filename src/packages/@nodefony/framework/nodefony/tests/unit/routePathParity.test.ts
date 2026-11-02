/**
 * Deux grammaires lisent un chemin de route, et la frontière des paquets les
 * empêche d'être une seule : le Router du framework COMPILE la grammaire
 * complète (`Route.ts#REG_ROUTE`), le cœur isomorphe LIT la forme simple
 * (`nodefony` → `runtime/routePath.ts`), que la socket remplit et que le
 * catalogue d'administration liste. Sur un gabarit simple, les deux doivent
 * dire la même chose — et un chemin concret rempli par le cœur doit être
 * reconnu par la route, avec les valeurs d'origine.
 */
import { describe, it, expect } from "vitest";
import {
  fillRoutePath,
  isSimpleRouteTemplate,
  routePathParams,
} from "nodefony";
import Route from "../../src/Route.js";

const SIMPLE = [
  "/chat/messages/{id}",
  "/chat/{room}/messages/{id}",
  "/nodefony/kernel/api/module/{name}/docs/{slug}",
  "/{a}",
];

describe("gabarit de route — le cœur et le Router lisent la même chose", () => {
  it("mêmes noms de variables, dans le même ordre", () => {
    for (const path of SIMPLE) {
      expect(isSimpleRouteTemplate(path), path).toBe(true);
      expect(routePathParams(path), path).toEqual(
        new Route("parity", { path }).variables,
      );
    }
  });

  it("un chemin rempli par le cœur est reconnu par la route, valeurs d'origine rendues", () => {
    const route = new Route("parity", { path: "/chat/{room}/messages/{id}" });
    const filled = fillRoutePath("/chat/{room}/messages/{id}", {
      room: "salon é/1",
      id: "a?b#c",
    });
    const match = new RegExp(route.pattern ?? "").exec(filled);
    expect(match, filled).not.toBe(null);
    expect(match?.slice(1).map((v) => decodeURIComponent(v))).toEqual([
      "salon é/1",
      "a?b#c",
    ]);
  });
});
