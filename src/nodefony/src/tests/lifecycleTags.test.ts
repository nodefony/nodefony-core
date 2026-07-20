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
      // `name` : JS infère le nom d'une arrow depuis la const qui la porte.
      name: "fn",
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
      name: "fn",
    });
  });

  // ── `name` : de quoi NOMMER un hook posé hors d'un Module ──────────────────
  // Un `kernel.on("onBoot", …)` à la main ne porte pas d'`owner`. En production
  // son échec INTERROMPT le boot ; sans ce repli le journal écrit « (anonyme) »
  // et l'exploitant n'a aucun moyen de remonter au code fautif.
  it("dérive `name` d'une fonction NOMMÉE (repli d'identification sans owner)", () => {
    function connectBillingDatabase(): void {}
    expect(readListenerTags(connectBillingDatabase)).to.deep.equal({
      owner: undefined,
      critical: undefined,
      name: "connectBillingDatabase",
    });
  });

  it("`name` undefined pour une lambda VRAIMENT anonyme (pas de nom inféré)", () => {
    // Passée inline : aucune const ne lui prête son nom → `name === ""`, qu'on
    // normalise en `undefined` (une chaîne vide dans un log ne dit rien).
    expect(readListenerTags((): void => {}).name).to.equal(undefined);
    expect(readListenerTags(function (): void {}).name).to.equal(undefined);
  });

  it("`name` est lu sur la fonction DÉBALLÉE, pas sur le wrapper de once()", () => {
    const ee = new EventEmitter();
    function bootRedis(): void {}
    ee.once("boot", bootRedis);
    const [wrapper] = ee.rawListeners("boot");
    // Le wrapper interne de Node s'appelle `onceWrapper` : le lire donnerait un
    // nom qui ne désigne que Node, jamais le code de l'utilisateur.
    expect(readListenerTags(wrapper).name).to.equal("bootRedis");
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
      name: "fn",
    });
  });

  it("préserve la criticité true (module critique par défaut)", () => {
    const fn = (): void => {};
    tagListener(fn, "http", true);
    expect(readListenerTags(fn)).to.deep.equal({
      owner: "http",
      critical: true,
      name: "fn",
    });
  });
});
