import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import Injector, { DI_SCOPE_METADATA } from "../kernel/injector/injector";
import Service from "../Service";
import Container from "../Container";
import { injectable } from "../kernel/decorators/kernelDecorator";

/**
 * `Injector.isInjectable` — la seule façon de distinguer une classe
 * `@injectable` d'une fonction ordinaire (règle d'admission des canaux temps
 * réel, #622). Jamais par le texte de la fonction : un minifieur le réécrit.
 */
describe("Injector.isInjectable", () => {
  @injectable()
  class Decorated extends Service {
    constructor() {
      super("decorated622", new Container());
    }
  }
  class Child extends Decorated {}

  it("classe décorée → vrai, quelle que soit sa portée", () => {
    @injectable({ scope: "transient" })
    class Transient extends Service {
      constructor() {
        super("transient622", new Container());
      }
    }
    assert.equal(Injector.isInjectable(Decorated), true);
    assert.equal(Injector.isInjectable(Transient), true);
  });

  it("sous-classe NON décorée → faux : la portée héritée ne l'inscrit nulle part", () => {
    // La métadonnée HÉRITÉE existe bien : c'est elle qu'il ne faut pas lire.
    assert.equal(Reflect.getMetadata(DI_SCOPE_METADATA, Child), "singleton");
    assert.equal(Injector.isInjectable(Child), false);
  });

  it("flèche, fonction, classe nue, valeur non fonction → faux", () => {
    class Bare {}
    for (const value of [
      () => true,
      function rule() {},
      Bare,
      {},
      null,
      "Decorated",
    ]) {
      assert.equal(Injector.isInjectable(value), false);
    }
  });

  it("une métadonnée posée sur un OBJET ne le fait pas passer pour une classe", () => {
    const forged = {};
    Reflect.defineMetadata(DI_SCOPE_METADATA, "singleton", forged);
    assert.equal(Injector.isInjectable(forged), false);
  });
});
