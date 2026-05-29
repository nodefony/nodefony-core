/// <reference types="node" />
/*
 *   NODEFONY FRAMEWORK UNIT TEST — MOCHA STYLE
 *   Résilience de boot — tags owner/critical sur les listeners lifecycle
 */

import { expect } from "chai";
import { EventEmitter } from "node:events";
import { tagListener, readListenerTags } from "../kernel/lifecycleTags";

describe("lifecycleTags", () => {
  it("tague puis relit owner + critical sur une fonction directe", () => {
    const fn = (): void => {};
    const same = tagListener(fn, "mon-module", false);
    expect(same).to.equal(fn); // taggé EN PLACE
    expect(readListenerTags(fn)).to.deep.equal({
      owner: "mon-module",
      critical: false,
    });
  });

  it("retourne {} pour null / undefined", () => {
    expect(readListenerTags(null)).to.deep.equal({});
    expect(readListenerTags(undefined)).to.deep.equal({});
  });

  it("listener non tagué → owner/critical undefined", () => {
    const fn = (): void => {};
    expect(readListenerTags(fn)).to.deep.equal({
      owner: undefined,
      critical: undefined,
    });
  });

  it("DÉBALLE le wrapper de once() (rawListeners renvoie le wrapper, pas la fn)", () => {
    const ee = new EventEmitter();
    const fn = (): void => {};
    ee.once("boot", tagListener(fn, "redis", false));
    const [wrapper] = ee.rawListeners("boot");
    // le wrapper once() n'est PAS la fonction d'origine…
    expect(wrapper).to.not.equal(fn);
    // …mais readListenerTags le déballe via `.listener` et retrouve les tags.
    expect(readListenerTags(wrapper)).to.deep.equal({
      owner: "redis",
      critical: false,
    });
  });

  it("préserve la criticité true (module critique par défaut)", () => {
    const fn = (): void => {};
    tagListener(fn, "http", true);
    expect(readListenerTags(fn)).to.deep.equal({
      owner: "http",
      critical: true,
    });
  });
});
