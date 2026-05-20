import { expect } from "chai";
import "mocha";
import assert from "node:assert";
import { nodefonyError } from "../index";

describe("nodefonyError", () => {
  describe("construction", () => {
    it("string message + code → message/code/name/errorType", () => {
      const e = new nodefonyError("boom", 502);
      expect(e).to.be.instanceOf(Error);
      expect(e).to.be.instanceOf(nodefonyError);
      expect(e.message).to.equal("boom");
      expect(e.code).to.equal(502);
      expect(e.name).to.equal("nodefonyError");
      // Quirk : pour un message string, getType() retombe sur
      // message.constructor.name → "String" (pas "Error"). Comportement réel.
      expect(e.errorType).to.equal("String");
    });

    it("code est null par défaut (sans 2e argument)", () => {
      const e = new nodefonyError("no code");
      expect(e.code).to.equal(null);
    });

    it("wrappe une Error native — copie message + stack", () => {
      const orig = new Error("native boom");
      const e = new nodefonyError(orig);
      expect(e.message).to.equal("native boom");
      expect(e.stack).to.equal(orig.stack);
      expect(e.errorType).to.equal("Error");
    });
  });

  describe("détection de type", () => {
    it("wrappe une TypeError → errorType TypeError", () => {
      expect(new nodefonyError(new TypeError("t")).errorType).to.equal("TypeError");
    });

    it("wrappe une ReferenceError → errorType ReferenceError", () => {
      expect(new nodefonyError(new ReferenceError("r")).errorType).to.equal("ReferenceError");
    });

    it("wrappe une SyntaxError → errorType SyntaxError", () => {
      expect(new nodefonyError(new SyntaxError("s")).errorType).to.equal("SyntaxError");
    });

    it("wrappe une AssertionError → errorType + actual/expected/operator", () => {
      const ae = new assert.AssertionError({
        actual: 1,
        expected: 2,
        operator: "===",
        message: "ne",
      });
      const e = new nodefonyError(ae);
      expect(e.errorType).to.equal("AssertionError");
      expect(e.actual).to.equal(1);
      expect(e.expected).to.equal(2);
      expect(e.operator).to.equal("===");
    });

    it("static detectType classe correctement", () => {
      expect(nodefonyError.detectType(new TypeError())).to.equal("TypeError");
      expect(nodefonyError.detectType(new Error())).to.equal("Error");
      // non-Error → false
      expect(nodefonyError.detectType("nope" as unknown as Error)).to.equal(false);
    });

    it("static isError — type guard", () => {
      expect(nodefonyError.isError(new Error())).to.equal(true);
      expect(nodefonyError.isError(new nodefonyError("x"))).to.equal(true);
      expect(nodefonyError.isError("string")).to.equal(false);
      expect(nodefonyError.isError(null)).to.equal(false);
    });
  });

  describe("parseMessage — argument objet", () => {
    it("objet {status, message} → code depuis status + message", () => {
      const e = new nodefonyError({ status: 503, message: "down" } as unknown as Error);
      expect(e.code).to.equal(503);
      expect(e.message).to.equal("down");
    });

    it("objet {code} → code, message = inspect(obj) si pas de message", () => {
      const e = new nodefonyError({ code: 418 } as unknown as Error);
      expect(e.code).to.equal(418);
      expect(e.message).to.be.a("string").and.not.empty;
    });
  });

  describe("getDefaultMessage", () => {
    it("remplit message via STATUS_CODES quand message vide + code", () => {
      const e = new nodefonyError();
      e.code = 404;
      e.getDefaultMessage();
      expect(e.message).to.equal("Not Found");
    });

    it("ne touche pas un message déjà présent", () => {
      const e = new nodefonyError("present", 500);
      e.getDefaultMessage();
      expect(e.message).to.equal("present");
    });
  });

  describe("toJSON", () => {
    it("exclut context/resolver/container/secure, garde le reste", () => {
      const e = new nodefonyError("boom", 500);
      e.context = { huge: true };
      e.resolver = {};
      e.container = {};
      e.secure = true;
      e.custom = "keep";
      const json = (e as unknown as { toJSON(): Record<string, unknown> }).toJSON();
      expect(json.context).to.equal(undefined);
      expect(json.resolver).to.equal(undefined);
      expect(json.container).to.equal(undefined);
      expect(json.secure).to.equal(undefined);
      expect(json.custom).to.equal("keep");
      expect(json.code).to.equal(500);
      expect(json.message).to.equal("boom");
    });
  });

  describe("toString", () => {
    it("retourne une string contenant le message (mode non-prod, sans kernel)", () => {
      const e = new nodefonyError("readable error", 500);
      const str = e.toString();
      expect(str).to.be.a("string");
      expect(str).to.include("readable error");
    });
  });
});
