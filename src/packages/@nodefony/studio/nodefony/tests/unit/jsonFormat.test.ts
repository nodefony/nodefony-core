/// <reference types="node" />
/**
 * Unit — helpers purs de la famille JSON du UI kit Studio
 * (`frontend/src/components/ui/json/jsonFormat.ts`). Aucune dépendance → testables
 * sans React. Durcissement aux limites : valeurs exotiques, troncature, parse
 * défensif (le rendu d'un message WebSocket en dépend).
 */
import { describe, it } from "vitest";
import { expect } from "chai";
import {
  jsonKind,
  isExpandable,
  primitiveText,
  countLabel,
  truncate,
  jsonPreview,
  safeStringify,
  tryParseJson,
} from "../../../frontend/src/components/ui/json/jsonFormat";

describe("jsonKind — classification", () => {
  it("classe chaque type JSON", () => {
    expect(jsonKind("x")).to.equal("string");
    expect(jsonKind(42)).to.equal("number");
    expect(jsonKind(10n)).to.equal("number"); // bigint → number
    expect(jsonKind(true)).to.equal("boolean");
    expect(jsonKind(null)).to.equal("null");
    expect(jsonKind(undefined)).to.equal("null");
    expect(jsonKind([1])).to.equal("array");
    expect(jsonKind({ a: 1 })).to.equal("object");
  });
});

describe("isExpandable", () => {
  it("conteneur non vide → true ; vide / primitive → false", () => {
    expect(isExpandable({ a: 1 })).to.equal(true);
    expect(isExpandable([1])).to.equal(true);
    expect(isExpandable({})).to.equal(false);
    expect(isExpandable([])).to.equal(false);
    expect(isExpandable("x")).to.equal(false);
    expect(isExpandable(null)).to.equal(false);
  });
});

describe("primitiveText", () => {
  it("string entre guillemets, null/undefined distincts", () => {
    expect(primitiveText("hi")).to.equal('"hi"');
    expect(primitiveText(42)).to.equal("42");
    expect(primitiveText(false)).to.equal("false");
    expect(primitiveText(null)).to.equal("null");
    expect(primitiveText(undefined)).to.equal("undefined");
  });
});

describe("countLabel — pluriel FR", () => {
  it("tableau / objet, singulier vs pluriel", () => {
    expect(countLabel([1])).to.equal("1 élément");
    expect(countLabel([1, 2])).to.equal("2 éléments");
    expect(countLabel({ a: 1 })).to.equal("1 clé");
    expect(countLabel({ a: 1, b: 2 })).to.equal("2 clés");
  });
});

describe("truncate", () => {
  it("≤ max inchangé ; > max ellipse (longueur = max)", () => {
    expect(truncate("abc", 5)).to.equal("abc");
    expect(truncate("abcde", 5)).to.equal("abcde");
    const out = truncate("abcdef", 5);
    expect(out).to.equal("abcd…");
    expect(out.length).to.equal(5);
  });
});

describe("jsonPreview — aperçu une ligne sûr", () => {
  it("primitive et conteneur compact, tronqué", () => {
    expect(jsonPreview("hi")).to.equal('"hi"');
    expect(jsonPreview({ a: 1 })).to.equal('{"a":1}');
    const out = jsonPreview({ big: "z".repeat(200) }, 20);
    expect(out.length).to.equal(20);
    expect(out.endsWith("…")).to.equal(true);
  });
  it("cycle → repli String sans throw", () => {
    const c: Record<string, unknown> = {};
    c.self = c;
    expect(() => jsonPreview(c)).to.not.throw();
    expect(jsonPreview(c)).to.be.a("string");
  });
});

describe("safeStringify", () => {
  it("objet indenté ; cycle → repli String", () => {
    expect(safeStringify({ a: 1 })).to.equal('{\n  "a": 1\n}');
    const c: Record<string, unknown> = {};
    c.self = c;
    expect(() => safeStringify(c)).to.not.throw();
  });
});

describe("tryParseJson — parse défensif (rendu message WS)", () => {
  it("objet / tableau JSON → ok avec valeur parsée", () => {
    expect(tryParseJson('{"a":1}')).to.deep.equal({
      ok: true,
      value: { a: 1 },
    });
    expect(tryParseJson("[1,2]")).to.deep.equal({ ok: true, value: [1, 2] });
    expect(tryParseJson('  {"a":1}  ')).to.deep.equal({
      ok: true,
      value: { a: 1 },
    });
  });
  it("texte simple / JSON invalide / vide → non ok (valeur = entrée)", () => {
    expect(tryParseJson("hello")).to.deep.equal({ ok: false, value: "hello" });
    expect(tryParseJson("42")).to.deep.equal({ ok: false, value: "42" });
    expect(tryParseJson("{bad")).to.deep.equal({ ok: false, value: "{bad" });
    expect(tryParseJson("")).to.deep.equal({ ok: false, value: "" });
  });
});
