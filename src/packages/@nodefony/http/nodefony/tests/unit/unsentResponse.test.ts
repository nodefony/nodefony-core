/// <reference types="node" />
/**
 * Avertissement de développement d'une requête restée sans réponse : il nomme
 * l'action, ce qu'elle a rendu, et le geste qui convient. Vécu : un `null`
 * rendu pour un id absent laissait la requête pendre 30 s jusqu'au 504, avec
 * un message générique qui ne disait ni quelle action ni quoi faire.
 */
import { describe, expect, it } from "vitest";
import { unsentResponseWarning } from "../../src/context/unsentResponse.js";
import type { IRouteResolver } from "../../interfaces/IRouting.js";

function resolver(unrendered: string | null): IRouteResolver {
  return {
    route: { name: "books-get" },
    resolve: true,
    controller: { name: "BookController" },
    actionName: "detail",
    unrendered,
  } as unknown as IRouteResolver;
}

describe("unsentResponseWarning", () => {
  it("🔴 null : nomme l'action et la route, et dit de lever un 404", () => {
    const msg = unsentResponseWarning(resolver("null"), "/api/books/1");
    expect(msg).toContain("BookController.detail (route books-get)");
    expect(msg).toContain("a rendu null");
    expect(msg).toContain("HttpError(…, 404)");
    expect(msg).toContain("délai d'expiration");
  });

  it("undefined : soupçonne un return oublié", () => {
    const msg = unsentResponseWarning(resolver("undefined"), "/x");
    expect(msg).toContain("n'a rien rendu");
    expect(msg).toContain("« return » oublié");
  });

  it("une instance de classe : la nomme, et demande sa forme JSON", () => {
    const msg = unsentResponseWarning(resolver("une instance de Book"), "/x");
    expect(msg).toContain("a rendu une instance de Book");
    expect(msg).toContain("objet simple");
  });

  it("sans resolver (waitAsync posé par l'application) : l'URL, sans rien inventer", () => {
    const msg = unsentResponseWarning(null, "/api/stream");
    expect(msg).toContain("L'action de /api/stream n'a rien envoyé");
    expect(msg).not.toContain("a rendu");
  });
});
