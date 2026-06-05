/* eslint-disable @typescript-eslint/no-explicit-any */
/*
 *   NODEFONY FRAMEWORK UNIT TEST — shim browser `node:events`
 *
 *   Vérifie que le shim isomorphe `client/shim/events.ts` couvre TOUTE l'API
 *   EventEmitter réellement appelée par le core (Event.ts / Service.ts) côté
 *   navigateur. Le build serveur utilise `node:events` NATIF ; ce test protège
 *   le chemin BROWSER, où tsc est un faux négatif (le shim est typé permissif).
 *
 *   Régression gravée le 2026-06-05 : `rawListeners` manquait au shim alors que
 *   `Event.emitAsync`/`emitAsyncGuarded` (le bus async `fireAsync`) l'appelle
 *   dans le hot path → `TypeError` au runtime browser, invisible au typecheck.
 *
 *   MOCHA STYLE
 */

import { assert } from "chai";
import { EventEmitter } from "../client/shim/events";

// Surface contractuelle = méthodes EventEmitter appelées par Event.ts + Service.ts
// (dérivée par grep du source). Toute régression — le core appelle une méthode
// absente du shim — doit casser ICI, pas silencieusement au runtime navigateur.
const REQUIRED_API = [
  "on",
  "once",
  "off",
  "emit",
  "addListener",
  "removeListener",
  "removeAllListeners",
  "listenerCount",
  "listeners",
  "eventNames",
  "setMaxListeners",
  "getMaxListeners",
  "rawListeners",
  "prependListener",
  "prependOnceListener",
] as const;

describe("client/shim/events — parité API EventEmitter (core isomorphe)", () => {
  it("expose toutes les méthodes appelées par Event/Service", () => {
    const e = new EventEmitter();
    for (const m of REQUIRED_API) {
      assert.strictEqual(
        typeof (e as any)[m],
        "function",
        `shim manque la méthode EventEmitter '${m}' (appelée par le core)`,
      );
    }
  });

  it("on/emit dispatch + listenerCount", () => {
    const e = new EventEmitter();
    let n = 0;
    e.on("x", () => {
      n += 1;
    });
    assert.strictEqual(e.listenerCount("x"), 1);
    assert.strictEqual(e.emit("x"), true);
    assert.strictEqual(e.emit("absent"), false);
    assert.strictEqual(n, 1);
  });

  it("once() ne fire qu'une fois puis se détache", () => {
    const e = new EventEmitter();
    let n = 0;
    e.once("x", () => {
      n += 1;
    });
    e.emit("x");
    e.emit("x");
    assert.strictEqual(n, 1);
    assert.strictEqual(e.listenerCount("x"), 0);
  });

  it("off / removeAllListeners détachent", () => {
    const e = new EventEmitter();
    const fn = () => {};
    e.on("x", fn).on("x", () => {});
    e.off("x", fn);
    assert.strictEqual(e.listenerCount("x"), 1);
    e.removeAllListeners("x");
    assert.strictEqual(e.listenerCount("x"), 0);
  });

  it("rawListeners() retourne une COPIE (hot path emitAsync)", () => {
    const e = new EventEmitter();
    e.on("x", () => {}).on("x", () => {});
    const raw = e.rawListeners("x");
    assert.strictEqual(raw.length, 2);
    raw.length = 0; // muter la copie ne doit pas toucher l'interne
    assert.strictEqual(e.listenerCount("x"), 2);
  });

  it("prependListener insère en TÊTE", () => {
    const e = new EventEmitter();
    const order: string[] = [];
    e.on("x", () => order.push("normal"));
    e.prependListener("x", () => order.push("prepended"));
    e.emit("x");
    assert.deepStrictEqual(order, ["prepended", "normal"]);
  });

  it("prependOnceListener : tête + une seule fois", () => {
    const e = new EventEmitter();
    const order: string[] = [];
    e.on("x", () => order.push("normal"));
    e.prependOnceListener("x", () => order.push("once"));
    e.emit("x");
    e.emit("x");
    assert.deepStrictEqual(order, ["once", "normal", "normal"]);
  });

  it("emit isole un listener qui throw (browser : ne crash pas)", () => {
    const e = new EventEmitter();
    let reached = false;
    const original = console.error;
    console.error = () => {}; // silence le warning volontaire du shim
    try {
      e.on("x", () => {
        throw new Error("boom");
      });
      e.on("x", () => {
        reached = true;
      });
      assert.strictEqual(e.emit("x"), true);
    } finally {
      console.error = original;
    }
    assert.strictEqual(reached, true);
  });
});
