import { describe, expect, it } from "vitest";
import deepmerge from "./index.js";

/**
 * Le shim de deepmerge (overrides de la racine) : la pollution de prototype de
 * GHSA-gcqx-w48m-w2h4 est refusée — vue ROUGE sur deepmerge 4.3.1 (cibles
 * `Object.create(null)` et primitive : `polluted === true`) — et le
 * comportement d'origine est conservé, celui dont dépend le plugin Svelte.
 */
const poisoned = () => JSON.parse('{"__proto__":{"polluted":true}}');

describe("shim deepmerge — pollution de prototype refusée", () => {
  it("une cible sans prototype ne reçoit pas le __proto__ de la source", () => {
    const out = deepmerge(Object.create(null), poisoned());
    expect(out.polluted).toBeUndefined();
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
  });

  it("une cible primitive non plus", () => {
    expect(deepmerge(1, poisoned()).polluted).toBeUndefined();
  });

  it("ni en profondeur, ni par deepmerge.all", () => {
    const deep = JSON.parse('{"a":{"__proto__":{"polluted":true}}}');
    expect(
      deepmerge({ a: Object.create(null) }, deep).a.polluted,
    ).toBeUndefined();
    expect(
      deepmerge.all([Object.create(null), poisoned()]).polluted,
    ).toBeUndefined();
  });

  it("constructor et prototype ne sont pas recopiés", () => {
    const out = deepmerge(
      {},
      JSON.parse('{"constructor":{"x":1},"prototype":{"y":2}}'),
    );
    expect(Object.hasOwn(out, "constructor")).toBe(false);
    expect(Object.hasOwn(out, "prototype")).toBe(false);
  });
});

describe("shim deepmerge — comportement de la 4.3.1 conservé", () => {
  it("fusionne en profondeur sans modifier les entrées", () => {
    const a = { x: { y: 1 }, list: [1] };
    const b = { x: { z: 2 }, list: [2] };
    expect(deepmerge(a, b)).toEqual({ x: { y: 1, z: 2 }, list: [1, 2] });
    expect(a).toEqual({ x: { y: 1 }, list: [1] });
  });

  it("arrayMerge remplace les tableaux — l'usage de vite-plugin-svelte", () => {
    const out = deepmerge(
      { compilerOptions: { dev: true }, extensions: [".svelte"] },
      { compilerOptions: { css: "injected" }, extensions: [".svx"] },
      { arrayMerge: (target, source) => source ?? target },
    );
    expect(out).toEqual({
      compilerOptions: { dev: true, css: "injected" },
      extensions: [".svx"],
    });
  });

  it("garde les symboles, les Date et RegExp tels quels, et clone: false", () => {
    const s = Symbol("k");
    const date = new Date(0);
    const shared = { n: 1 };
    const out = deepmerge(
      { [s]: 1 },
      { d: date, r: /x/u, shared },
      { clone: false },
    );
    expect(out[s]).toBe(1);
    expect(out.d).toBe(date);
    expect(out.r).toEqual(/x/u);
    expect(out.shared).toBe(shared);
  });

  it("deepmerge.all exige un tableau", () => {
    expect(() => deepmerge.all({})).toThrow(
      "first argument should be an array",
    );
    expect(deepmerge.all([{ a: 1 }, { b: 2 }, { a: 3 }])).toEqual({
      a: 3,
      b: 2,
    });
  });
});
