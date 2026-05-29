/// <reference types="node" />
import { expect } from "chai";
import { acceptParser } from "../../src/context/http/parser.js";

// Négociation de contenu — parsing du header `Accept` (RFC 9110 §12.5.1).
// acceptParser(str) → tableau d'entrées { type: RegExp, subtype: RegExp, q?, … }
// trié par qualité `q` décroissante. Fonction pure (string → tableau).
describe("acceptParser — négociation de contenu (Accept header)", () => {
  it("sans argument → wildcard par défaut */*", () => {
    const r = acceptParser();
    expect(r).to.have.length(1);
    expect(r[0].type.test("text")).to.equal(true);
    expect(r[0].subtype.test("html")).to.equal(true);
  });

  it("type/subtype concret → regex correspondantes", () => {
    const r = acceptParser("text/html");
    expect(r[0].type.test("text")).to.equal(true);
    expect(r[0].subtype.test("html")).to.equal(true);
    expect(r[0].type.test("image")).to.equal(false);
  });

  it("'*/*' → wildcards qui matchent tout", () => {
    const r = acceptParser("*/*");
    expect(r[0].type.test("anything")).to.equal(true);
    expect(r[0].subtype.test("anything")).to.equal(true);
  });

  it("type wildcardé 'image/*'", () => {
    const r = acceptParser("image/*");
    expect(r[0].type.test("image")).to.equal(true);
    expect(r[0].subtype.test("png")).to.equal(true);
  });

  it("liste multiple → un objet par type", () => {
    const r = acceptParser("text/html,application/json");
    expect(r).to.have.length(2);
  });

  it("trie par q décroissant (qualité)", () => {
    const r = acceptParser("text/html;q=0.3,application/json;q=0.9");
    expect(r[0].subtype.test("json")).to.equal(true);
    expect(r[1].subtype.test("html")).to.equal(true);
    expect(r[0].q).to.equal(0.9);
  });

  it("q par défaut = 1 quand absent (passe avant un q explicite < 1)", () => {
    const r = acceptParser("text/html,application/json;q=0.5");
    expect(r[0].subtype.test("html")).to.equal(true);
  });

  it("parse les paramètres additionnels (charset)", () => {
    const r = acceptParser("text/html;charset=utf-8");
    expect(r[0].charset).to.equal("utf-8");
  });

  it("throw si un type est vide (media-range manquant)", () => {
    expect(() => acceptParser(";q=1")).to.throw();
  });
});
