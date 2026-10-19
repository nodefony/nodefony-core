/// <reference types="node" />
import { expect } from "vitest";
import { toAdminQuery } from "../../controller/AdminApiController";

// `IAdminRequest.query` se déclare `Record<string, string | string[]>` : la
// projection doit tenir ce contrat à l'exécution, sans allouer pour le cas
// courant, et sans qu'une clé de la requête atteigne le prototype de la copie.
describe("toAdminQuery — paramètres d'URL du plan d'administration", () => {
  it("rend la source elle-même quand elle est déjà plate (aucune allocation)", () => {
    const source = { a: "1", list: ["x", "y"] };
    expect(toAdminQuery(source)).to.equal(source);
  });

  it("écarte les valeurs imbriquées que qs produit pour a[b]=1", () => {
    const out = toAdminQuery({ a: "1", nested: { b: "1" }, mixed: ["x", 2] });
    expect({ ...out }).to.deep.equal({ a: "1" });
  });

  it("absente → objet vide", () => {
    expect(toAdminQuery(undefined)).to.deep.equal({});
  });

  it("une clé __proto__ reste une donnée : le prototype de la copie n'est jamais remplacé", () => {
    const source: Record<string, unknown> = { nested: { b: "1" } };
    Object.defineProperty(source, "__proto__", {
      value: ["polluant"],
      enumerable: true,
      configurable: true,
      writable: true,
    });
    const out = toAdminQuery(source);
    expect(Object.getPrototypeOf(out)).to.not.equal(Array.prototype);
    expect(Array.isArray(Object.getPrototypeOf(out))).to.equal(false);
    expect(Object.hasOwn(out, "__proto__")).to.equal(true);
    expect(out["__proto__" as keyof typeof out]).to.deep.equal(["polluant"]);
  });
});
