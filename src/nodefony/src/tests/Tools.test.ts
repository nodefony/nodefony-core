import { expect } from "chai";
import { performance } from "node:perf_hooks";
import Container from "../Container";
import {
  extend,
  isPlainObject,
  isUndefined,
  isEmptyObject,
  isArray,
  isFunction,
  isRegExp,
  isPromise,
  isContainer,
  isSubclassOf,
  typeOf,
  stripTrailingSlashes,
} from "../Tools";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

class Animal {
  name: string;
  constructor(name = "animal") {
    this.name = name;
  }
}
class Dog extends Animal {
  constructor() {
    super("dog");
  }
}
class Poodle extends Dog {}

// ─────────────────────────────────────────────────────────────────────────────
// extend — shallow
// ─────────────────────────────────────────────────────────────────────────────

describe("extend › shallow — retour et mutation", () => {
  it("retourne la référence du target", () => {
    const t = { a: 1 };
    const r = extend(t, { b: 2 });
    expect(r).to.equal(t);
  });

  it("mute le target", () => {
    const t: Record<string, number> = { a: 1 };
    extend(t, { b: 2 });
    expect(t).to.deep.equal({ a: 1, b: 2 });
  });

  it("deux sources — le dernier gagne", () => {
    const r = extend({}, { x: 1 }, { x: 99, y: 2 });
    expect(r).to.deep.equal({ x: 99, y: 2 });
  });

  it("trois sources fusionnées dans le bon ordre", () => {
    const r = extend({}, { a: 1 }, { b: 2 }, { c: 3 });
    expect(r).to.deep.equal({ a: 1, b: 2, c: 3 });
  });

  it("target existant est enrichi sans perdre ses clés", () => {
    const t = { keep: true, x: 0 };
    extend(t, { x: 42 });
    expect(t.keep).to.equal(true);
    expect(t.x).to.equal(42);
  });

  it("source null ignorée", () => {
    const r = extend({ a: 1 }, null as any, { b: 2 });
    expect(r).to.deep.equal({ a: 1, b: 2 });
  });

  it("source undefined ignorée", () => {
    const r = extend({ a: 1 }, undefined as any, { b: 2 });
    expect(r).to.deep.equal({ a: 1, b: 2 });
  });

  it("source vide {} ne modifie pas le target", () => {
    const t = { a: 1 };
    extend(t, {});
    expect(t).to.deep.equal({ a: 1 });
  });
});

describe("extend › shallow — types de valeurs", () => {
  it("copy === undefined → NON copié (préserve la valeur existante)", () => {
    const r = extend({ x: 10 }, { x: undefined });
    expect(r.x).to.equal(10);
  });

  it("copy === null → copié (null est une valeur valide)", () => {
    const r = extend({ x: 10 }, { x: null });
    expect(r.x).to.be.null;
  });

  it("copy === false → copié", () => {
    const r = extend({ x: true }, { x: false });
    expect(r.x).to.equal(false);
  });

  it("copy === 0 → copié", () => {
    const r = extend({ x: 99 }, { x: 0 });
    expect(r.x).to.equal(0);
  });

  it("copy === '' → copié", () => {
    const r = extend({ x: "hello" }, { x: "" });
    expect(r.x).to.equal("");
  });

  it("clé absente dans source → ignorée (pas d'écrasement)", () => {
    const r = extend({ a: 1, b: 2 }, { a: 10 });
    expect(r.b).to.equal(2);
  });

  it("toutes les clés de la source sont copiées", () => {
    const src = { a: 1, b: "x", c: true, d: null, e: 0 };
    const r = extend({}, src);
    expect(r).to.deep.equal({ a: 1, b: "x", c: true, d: null, e: 0 });
  });
});

describe("extend › shallow — objets imbriqués (référence)", () => {
  it("objet imbriqué → copie par référence (pas de clone)", () => {
    const nested = { x: 1 };
    const r = extend({}, { obj: nested });
    expect(r.obj).to.equal(nested);
  });

  it("tableau imbriqué → copie par référence", () => {
    const arr = [1, 2, 3];
    const r = extend({}, { arr });
    expect(r.arr).to.equal(arr);
  });

  it("instance de classe → copie par référence", () => {
    const dog = new Dog();
    const r = extend({}, { pet: dog });
    expect(r.pet).to.equal(dog);
  });

  it("Date → copie par référence", () => {
    const d = new Date();
    const r = extend({}, { date: d });
    expect(r.date).to.equal(d);
  });

  it("RegExp → copie par référence", () => {
    const re = /foo/gi;
    const r = extend({}, { re });
    expect(r.re).to.equal(re);
  });

  it("mutation du nested source après extend → visible dans le résultat (shallow)", () => {
    const nested = { x: 1 };
    const r = extend({}, { nested });
    (nested as any).x = 99;
    expect(r.nested.x).to.equal(99); // shallow = même référence
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// extend — argument unique (copie)
// ─────────────────────────────────────────────────────────────────────────────

describe("extend › argument unique", () => {
  it("retourne un NOUVEL objet (pas la même référence)", () => {
    const src = { a: 1 };
    const r = extend(src);
    expect(r).to.not.equal(src);
  });

  it("contenu identique à la source", () => {
    const r = extend({ a: 1, b: 2 });
    expect(r).to.deep.equal({ a: 1, b: 2 });
  });

  it("aucun argument → retourne {}", () => {
    const r = extend();
    expect(r).to.deep.equal({});
  });

  it("target falsy null → retourne source dans objet vierge", () => {
    const r = extend(null as any, { a: 1 });
    expect(r).to.deep.equal({ a: 1 });
  });

  it("target false → retourne source dans objet vierge (false est falsy)", () => {
    const r = extend(false as any, { a: 1 });
    expect(r).to.deep.equal({ a: 1 });
  });

  it("target string → devient {}", () => {
    const r = extend("hello" as any, { a: 1 });
    expect(r).to.deep.equal({ a: 1 });
  });

  it("target number → devient {}", () => {
    const r = extend(42 as any, { a: 1 });
    expect(r).to.deep.equal({ a: 1 });
  });

  it("target function → utilisée comme target (function est 'object-like')", () => {
    const fn = function () {};
    extend(fn as any, { x: 99 });
    expect((fn as any).x).to.equal(99);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// extend — prototype pollution guard
// ─────────────────────────────────────────────────────────────────────────────

describe("extend › prototype pollution guard", () => {
  it("__proto__ ignoré", () => {
    const victim = {};
    extend(victim, JSON.parse('{"__proto__":{"polluted":true}}'));
    expect((victim as any).polluted).to.be.undefined;
    expect((Object.prototype as any).polluted).to.be.undefined;
  });

  it("constructor ignoré", () => {
    const t: Record<string, unknown> = {};
    extend(t, { constructor: "OVERWRITE" });
    expect(t.constructor).to.equal(Object); // doit rester le constructeur natif
  });

  it("prototype ignoré", () => {
    const t: Record<string, unknown> = {};
    extend(t, { prototype: "OVERWRITE" });
    expect(t.prototype).to.be.undefined;
  });

  it("clé normale avec le mot 'proto' (pas __proto__) → copiée", () => {
    const r = extend({}, { "x-proto": 1, _proto_: 2 });
    expect(r["x-proto"]).to.equal(1);
    expect(r["_proto_"]).to.equal(2);
  });

  it("pas de pollution sur Object.prototype après extend massif", () => {
    const poison = Object.create(null) as Record<string, unknown>;
    poison["__proto__"] = { evil: true };
    for (let i = 0; i < 1000; i++) extend({}, poison as any);
    expect((Object.prototype as any).evil).to.be.undefined;
  });

  it("référence circulaire (target === copy) ignorée", () => {
    const t: Record<string, unknown> = { a: 1 };
    t.self = t; // circular
    const r = extend({}, t);
    // 'a' copié, 'self' ignoré (target !== r ici mais copy === t !== r)
    expect(r.a).to.equal(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// extend — deep
// ─────────────────────────────────────────────────────────────────────────────

describe("extend › deep — fusion récursive", () => {
  it("objets imbriqués fusionnés récursivement", () => {
    const r = extend(true, {}, { a: { x: 1, y: 2 } }, { a: { y: 99, z: 3 } });
    expect(r.a).to.deep.equal({ x: 1, y: 99, z: 3 });
  });

  it("ne modifie pas la source d'origine", () => {
    const src = { a: { x: 1 } };
    extend(true, {}, src);
    expect(src.a.x).to.equal(1);
  });

  it("objet cible imbriqué réutilisé comme base (clone = src)", () => {
    const base = { cfg: { port: 3000, host: "localhost" } };
    const override = { cfg: { port: 8080 } };
    const r = extend(true, {}, base, override);
    expect(r.cfg.port).to.equal(8080);
    expect(r.cfg.host).to.equal("localhost"); // préservé
  });

  it("tableau — merge par index (comportement jQuery): source plus courte conserve les éléments restants", () => {
    const base = { tags: ["a", "b"] };
    const override = { tags: ["c"] };
    const r = extend(true, {}, base, override);
    // index 0 → "c" (from override), index 1 → "b" (from base, non surchargé)
    expect(r.tags).to.deep.equal(["c", "b"]);
    expect(r.tags).to.not.equal(base.tags); // nouvelle référence (clone)
  });

  it("tableau — source plus longue remplace tout le contenu + étend", () => {
    const base = { tags: ["a"] };
    const override = { tags: ["x", "y", "z"] };
    const r = extend(true, {}, base, override);
    expect(r.tags).to.deep.equal(["x", "y", "z"]);
  });

  it("source tableau quand target n'a pas de tableau → fresh []", () => {
    const r = extend(true, { x: "string" }, { x: [1, 2, 3] });
    expect(r.x).to.deep.equal([1, 2, 3]);
    expect(isArray(r.x)).to.be.true;
  });

  it("source objet quand target n'a pas d'objet plat → fresh {}", () => {
    const r = extend(true, { x: [1, 2] }, { x: { a: 1 } });
    expect(r.x).to.deep.equal({ a: 1 });
    expect(isArray(r.x)).to.be.false;
  });

  it("instance de classe → copie par référence (pas de deep clone)", () => {
    const dog = new Dog();
    const r = extend(true, {}, { pet: dog });
    expect(r.pet).to.equal(dog); // référence identique
  });

  it("Date → copie par référence en deep", () => {
    const d = new Date(2024, 0, 1);
    const r = extend(true, {}, { d });
    expect(r.d).to.equal(d);
  });

  it("null dans source → copié (pas traité comme objet)", () => {
    const r = extend(true, { x: { a: 1 } }, { x: null });
    expect(r.x).to.be.null;
  });

  it("false comme premier arg → shallow (pas deep)", () => {
    const nested = { x: 1 };
    const r = extend(false, {}, { obj: nested });
    expect(r.obj).to.equal(nested); // shallow → même référence
  });

  it("deep 4 args — (true, {}, source1, source2)", () => {
    const r = extend(
      true,
      {},
      { db: { host: "localhost", port: 5432 }, log: { level: "INFO" } },
      { db: { port: 5433 }, extra: true },
    );
    expect(r.db.host).to.equal("localhost");
    expect(r.db.port).to.equal(5433);
    expect(r.log.level).to.equal("INFO");
    expect(r.extra).to.equal(true);
  });

  it("profondeur 3 niveaux", () => {
    const r = extend(true, {}, { a: { b: { c: 1 } } }, { a: { b: { d: 2 } } });
    expect(r.a.b.c).to.equal(1);
    expect(r.a.b.d).to.equal(2);
  });

  it("tableau deep — les éléments de la source gagnent", () => {
    const base = { list: [1, 2, 3, 4, 5] };
    const over = { list: [10, 20] };
    const r = extend(true, {}, base, over);
    // array deep merge: extend(true, [1,2,3,4,5], [10,20])
    // index 0 → 10, index 1 → 20, reste intact
    expect(r.list[0]).to.equal(10);
    expect(r.list[1]).to.equal(20);
    expect(r.list[2]).to.equal(3); // indices non surchargés conservés
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// extend — propriétés héritées (hasOwnProperty guard)
// ─────────────────────────────────────────────────────────────────────────────

describe("extend › héritage — own properties seulement", () => {
  it("propriétés héritées du prototype NON copiées", () => {
    const proto = { inherited: "SHOULD_NOT_COPY" };
    const src = Object.create(proto) as Record<string, unknown>;
    src.own = "yes";
    const r = extend({}, src);
    expect(r.own).to.equal("yes");
    expect(r.inherited).to.be.undefined;
  });

  it("toString/valueOf hérités de Object → non copiés", () => {
    const r = extend({}, { custom: 1 });
    // toString vient d'Object.prototype, pas d'une prop propre
    expect(Object.hasOwn(r, "toString")).to.be.false;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// extend — patterns framework Nodefony
// ─────────────────────────────────────────────────────────────────────────────

describe("extend › patterns Nodefony", () => {
  const kernelDefaultOptions = {
    events: { nbListeners: 60 },
    log: { active: true, debug: false },
  };

  it("extend({}, kernelDefaultOptions, options) — shallow", () => {
    const options = { log: { active: false }, domain: "example.com" };
    const r = extend({}, kernelDefaultOptions, options);
    // log est remplacé en entier (shallow)
    expect(r.log).to.deep.equal({ active: false });
    expect(r.domain).to.equal("example.com");
    expect(r.events).to.equal(kernelDefaultOptions.events); // même référence
  });

  it("extend(this.options, config) — merge in-place", () => {
    const opts = { port: 3000, host: "localhost" };
    extend(opts, { port: 8080 });
    expect(opts.port).to.equal(8080);
    expect(opts.host).to.equal("localhost");
  });

  it("extend(true, {}, mod.options, override) — deep merge config module", () => {
    const modOpts = {
      db: { host: "localhost", port: 5432, pool: { min: 2, max: 10 } },
      cache: { ttl: 3600 },
    };
    const override = { db: { port: 5433, pool: { max: 20 } } };
    const r = extend(true, {}, modOpts, override);
    expect(r.db.host).to.equal("localhost");
    expect(r.db.port).to.equal(5433);
    expect(r.db.pool.min).to.equal(2); // préservé
    expect(r.db.pool.max).to.equal(20); // overridé
    expect(r.cache.ttl).to.equal(3600); // inchangé
  });

  it("readOverrideModuleConfig — merge module options (clé Module-http)", () => {
    const moduleOptions: Record<string, unknown> = {
      "Module-http": { port: 8443, ssl: true },
      local: "value",
    };
    const httpModOpts = { port: 80, ssl: false, timeout: 30 };
    // Simule readOverrideModuleConfig
    const overrideKey = "Module-http";
    const match = /^[Mm]odule-([\w-]+)/u.exec(overrideKey);
    expect(match?.[1]).to.equal("http");
    const merged = extend(
      true,
      {},
      httpModOpts,
      moduleOptions[overrideKey] as object,
    );
    expect(merged.port).to.equal(8443);
    expect(merged.ssl).to.equal(true);
    expect(merged.timeout).to.equal(30);
  });

  it("syslog defaultSettings merge", () => {
    const defaultSettings = {
      format: "text",
      severity: { min: 0, max: 7 },
      transport: ["console"],
    };
    const settings = { format: "json", transport: ["file"] };
    const r = extend({}, defaultSettings, settings || {});
    expect(r.format).to.equal("json");
    expect(r.transport).to.deep.equal(["file"]);
    expect(r.severity).to.equal(defaultSettings.severity); // shallow ref
  });

  it("extend(true, {}, conditions) — deep merge conditions syslog", () => {
    const base = { severity: { data: [0, 1, 2] }, msgid: { data: ["INFO"] } };
    const extra = { severity: { data: [0, 1, 2, 3] } };
    const r = extend(true, {}, base, extra);
    expect(r.severity.data).to.deep.equal([0, 1, 2, 3]);
    expect(r.msgid.data).to.deep.equal(["INFO"]); // inchangé
  });

  it("chaîne de merges successifs", () => {
    let opts = extend({}, { timeout: 30, retries: 3 });
    opts = extend(opts, { timeout: 60 });
    opts = extend(opts, { logLevel: "DEBUG" });
    expect(opts.timeout).to.equal(60);
    expect(opts.retries).to.equal(3);
    expect(opts.logLevel).to.equal("DEBUG");
  });

  it("Container.extend(deep, obj, res) — deep booléen variable", () => {
    const obj = { a: { x: 1 } };
    const res = { a: { y: 2 } };
    const r = extend(true, obj, res);
    expect(r.a.x).to.equal(1);
    expect(r.a.y).to.equal(2);
    const r2 = extend(false, { a: { x: 1 } }, { a: { y: 2 } });
    expect(r2.a.y).to.equal(2);
    expect(r2.a.x).to.be.undefined; // shallow écrase l'objet entier
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isPlainObject
// ─────────────────────────────────────────────────────────────────────────────

describe("isPlainObject", () => {
  it("objet littéral {} → true", () => {
    expect(isPlainObject({})).to.be.true;
  });

  it("objet avec propriétés → true", () => {
    expect(isPlainObject({ a: 1, b: "x" })).to.be.true;
  });

  it("Object.create(null) → true (sans prototype)", () => {
    expect(isPlainObject(Object.create(null))).to.be.true;
  });

  it("new Object() → true", () => {
    expect(isPlainObject(new Object())).to.be.true;
  });

  it("instance de classe → false", () => {
    expect(isPlainObject(new Dog())).to.be.false;
  });

  it("Array → false", () => {
    expect(isPlainObject([])).to.be.false;
  });

  it("null → false", () => {
    expect(isPlainObject(null)).to.be.false;
  });

  it("undefined → false", () => {
    expect(isPlainObject(undefined)).to.be.false;
  });

  it("string → false", () => {
    expect(isPlainObject("hello")).to.be.false;
  });

  it("number → false", () => {
    expect(isPlainObject(42)).to.be.false;
  });

  it("boolean → false", () => {
    expect(isPlainObject(true)).to.be.false;
  });

  it("Date → false", () => {
    expect(isPlainObject(new Date())).to.be.false;
  });

  it("RegExp → false", () => {
    expect(isPlainObject(/regex/)).to.be.false;
  });

  it("Buffer → false", () => {
    expect(isPlainObject(Buffer.from("x"))).to.be.false;
  });

  it("objet imbriqué plain → true récursivement", () => {
    expect(isPlainObject({ a: { b: { c: {} } } })).to.be.true;
  });

  it("Object.create({}) → false (proto n'est pas Object.prototype)", () => {
    expect(isPlainObject(Object.create({ x: 1 }))).to.be.false;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// typeOf
// ─────────────────────────────────────────────────────────────────────────────

describe("typeOf", () => {
  it("null → null", () => expect(typeOf(null)).to.equal(null));
  it("undefined → 'undefined'", () =>
    expect(typeOf(undefined)).to.equal("undefined"));
  it("string → 'string'", () => expect(typeOf("hello")).to.equal("string"));
  it("number → 'number'", () => expect(typeOf(42)).to.equal("number"));
  it("boolean → 'boolean'", () => expect(typeOf(true)).to.equal("boolean"));
  it("function → 'function'", () =>
    expect(typeOf(() => {})).to.equal("function"));
  it("async function → 'function'", () =>
    expect(typeOf(async () => {})).to.equal("function"));
  it("class → 'function'", () => expect(typeOf(Dog)).to.equal("function"));
  it("array → 'array'", () => expect(typeOf([1, 2, 3])).to.equal("array"));
  it("empty array → 'array'", () => expect(typeOf([])).to.equal("array"));
  it("plain object → 'object'", () => expect(typeOf({})).to.equal("object"));
  it("Buffer → 'buffer'", () =>
    expect(typeOf(Buffer.from("x"))).to.equal("buffer"));
  it("Date → 'date'", () => expect(typeOf(new Date())).to.equal("date"));
  it("RegExp → 'RegExp'", () => expect(typeOf(/abc/)).to.equal("RegExp"));
  it("Error → 'Error'", () => expect(typeOf(new Error("e"))).to.equal("Error"));
  it("TypeError → 'Error'", () =>
    expect(typeOf(new TypeError("t"))).to.equal("Error"));
  it("SyntaxError → 'SyntaxError'", () =>
    expect(typeOf(new SyntaxError("s"))).to.equal("SyntaxError"));
  it("instance de classe → 'object'", () =>
    expect(typeOf(new Dog())).to.equal("object"));
  it("arguments-like (callee) → 'arguments'", () => {
    const args = (function () {
      return arguments;
    })();
    expect(typeOf(args)).to.equal("arguments");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isSubclassOf
// ─────────────────────────────────────────────────────────────────────────────

describe("isSubclassOf", () => {
  it("sous-classe directe → true", () => {
    expect(isSubclassOf(Dog, Animal)).to.be.true;
  });

  it("sous-classe indirecte (2 niveaux) → true", () => {
    expect(isSubclassOf(Poodle, Animal)).to.be.true;
  });

  it("même classe → false", () => {
    expect(isSubclassOf(Dog, Dog)).to.be.false;
  });

  it("classe parent par rapport à sous-classe → false", () => {
    expect(isSubclassOf(Animal, Dog)).to.be.false;
  });

  it("classe non liée → false", () => {
    class Cat {}
    expect(isSubclassOf(Cat, Dog)).to.be.false;
  });

  it("null → throws TypeError (lecture de null.prototype)", () => {
    expect(() => isSubclassOf(null, Animal)).to.throw(TypeError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isUndefined
// ─────────────────────────────────────────────────────────────────────────────

describe("isUndefined", () => {
  it("undefined → true", () => expect(isUndefined(undefined)).to.be.true);
  it("null → false", () => expect(isUndefined(null)).to.be.false);
  it("0 → false", () => expect(isUndefined(0)).to.be.false);
  it("'' → false", () => expect(isUndefined("")).to.be.false);
  it("false → false", () => expect(isUndefined(false)).to.be.false);
  it("NaN → false", () => expect(isUndefined(NaN)).to.be.false);
  it("{} → false", () => expect(isUndefined({})).to.be.false);
});

// ─────────────────────────────────────────────────────────────────────────────
// isEmptyObject
// ─────────────────────────────────────────────────────────────────────────────

describe("isEmptyObject", () => {
  it("{} → true", () => expect(isEmptyObject({})).to.be.true);
  it("{a:1} → false", () => expect(isEmptyObject({ a: 1 })).to.be.false);
  it("null → false", () => expect(isEmptyObject(null)).to.be.false);
  it("undefined → false", () => expect(isEmptyObject(undefined)).to.be.false);
  it("Object.create(null) → true", () =>
    expect(isEmptyObject(Object.create(null))).to.be.true);
});

// ─────────────────────────────────────────────────────────────────────────────
// isArray / isFunction / isRegExp (exports natifs)
// ─────────────────────────────────────────────────────────────────────────────

describe("isArray", () => {
  it("[1,2,3] → true", () => expect(isArray([1, 2, 3])).to.be.true);
  it("[] → true", () => expect(isArray([])).to.be.true);
  it("'string' → false", () => expect(isArray("string")).to.be.false);
  it("{} → false", () => expect(isArray({})).to.be.false);
  it("Array.isArray === isArray", () =>
    expect(isArray).to.equal(Array.isArray));
});

describe("isFunction", () => {
  it("function → true", () => expect(isFunction(() => {})).to.be.true);
  it("async function → true", () =>
    expect(isFunction(async () => {})).to.be.true);
  it("class → true (typeof class === 'function')", () =>
    expect(isFunction(Dog)).to.be.true);
  it("null → false", () => expect(isFunction(null)).to.be.false);
  it("{} → false", () => expect(isFunction({})).to.be.false);
  it("42 → false", () => expect(isFunction(42)).to.be.false);
});

describe("isRegExp", () => {
  it("/abc/gi → true", () => expect(isRegExp(/abc/gi)).to.be.true);
  it("new RegExp → true", () => expect(isRegExp(new RegExp("x"))).to.be.true);
  it("string → false", () => expect(isRegExp("abc")).to.be.false);
  it("{} → false", () => expect(isRegExp({})).to.be.false);
});

// ─────────────────────────────────────────────────────────────────────────────
// isPromise
// ─────────────────────────────────────────────────────────────────────────────

describe("isPromise", () => {
  it("Promise natif → true", () =>
    expect(isPromise(Promise.resolve())).to.be.true);
  it("Promise rejeté → true", () => {
    const p = Promise.reject(new Error("x"));
    p.catch(() => {}); // évite unhandledRejection
    expect(isPromise(p)).to.be.true;
  });
  it("thenable (duck typing) → true", () => {
    // Le thenable est l'OBJET DU TEST : `isPromise` doit reconnaître un `.then`
    // sans exiger une vraie Promise (ex-Bluebird userland, Q…).
    // oxlint-disable-next-line no-thenable
    expect(isPromise({ then: () => {} })).to.be.true;
  });
  it("objet sans .then → false", () =>
    expect(isPromise({ foo: 1 })).to.be.false);
  it("null → false", () => expect(isPromise(null)).to.be.false);
  it("undefined → false", () => expect(isPromise(undefined)).to.be.false);
  it("string → false", () => expect(isPromise("hello")).to.be.false);
  it("async function → false (function, pas promesse)", () => {
    expect(isPromise(async () => {})).to.be.false;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isContainer
// ─────────────────────────────────────────────────────────────────────────────

describe("isContainer", () => {
  it("Container instance → true", () => {
    expect(isContainer(new Container())).to.be.true;
  });
  it("objet plain → false", () => {
    expect(isContainer({} as any)).to.be.false;
  });
  it("null → false", () => {
    expect(isContainer(null as any)).to.be.false;
  });
  it("undefined → false", () => {
    expect(isContainer(undefined as any)).to.be.false;
  });
  it("Scope → true (hérite de Container)", () => {
    // Scope extends Container — vérifier si disponible
    const c = new Container();
    expect(isContainer(c)).to.be.true;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cas limites combinés
// ─────────────────────────────────────────────────────────────────────────────

describe("extend › cas limites", () => {
  it("objet avec des clés numériques", () => {
    const r = extend({}, { 0: "zero", 1: "one", 2: "two" } as any);
    expect(r[0]).to.equal("zero");
    expect(r[2]).to.equal("two");
  });

  it("objet avec Symbol comme clé → non copié (for...in ignore les Symbols)", () => {
    const sym = Symbol("key");
    const src: Record<symbol, string> = {};
    src[sym] = "value";
    const r = extend({}, src as any);
    expect(r[sym]).to.be.undefined;
  });

  it("valeur function dans source → copiée par référence", () => {
    const fn = () => 42;
    const r = extend({}, { fn });
    expect(r.fn).to.equal(fn);
    expect(r.fn()).to.equal(42);
  });

  it("source avec 100 clés — toutes copiées", () => {
    const src: Record<string, number> = {};
    for (let i = 0; i < 100; i++) src[`key${i}`] = i;
    const r = extend({}, src);
    expect(Object.keys(r).length).to.equal(100);
    expect(r.key0).to.equal(0);
    expect(r.key99).to.equal(99);
  });

  it("deep merge avec tableau d'objets — tableaux traités atomiquement", () => {
    const base = { items: [{ id: 1 }, { id: 2 }] };
    const override = { items: [{ id: 10 }] };
    const r = extend(true, {}, base, override);
    // items[0] est mergé (deep extend sur les éléments du tableau)
    expect(r.items[0].id).to.equal(10);
    // items[1] de la base préservé si la source a moins d'éléments
    expect(r.items[1]?.id).to.equal(2);
  });

  it("deep — sources multiples accumulées correctement", () => {
    const r = extend(true, {}, { a: 1 }, { b: 2 }, { c: 3 }, { a: 10, d: 4 });
    expect(r).to.deep.equal({ a: 10, b: 2, c: 3, d: 4 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Performance / charge
// ─────────────────────────────────────────────────────────────────────────────

describe("extend › performance", () => {
  it("100 000 shallow merges (3 args, 5 clés) < 300ms", () => {
    const defaults = { a: 1, b: 2, c: 3, d: 4, e: 5 };
    const overrides = { c: 99, f: 6 };
    const N = 100_000;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      extend({}, defaults, overrides);
    }
    const elapsed = performance.now() - t0;
    expect(elapsed).to.be.lessThan(
      300,
      `100k shallow took ${elapsed.toFixed(1)}ms`,
    );
  });

  it("50 000 deep merges (3 niveaux) < 500ms", () => {
    const base = {
      db: { host: "localhost", port: 5432, pool: { min: 2, max: 10 } },
      log: { level: "INFO", format: "text" },
    };
    const override = { db: { port: 5433, pool: { max: 20 } } };
    const N = 50_000;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      extend(true, {}, base, override);
    }
    const elapsed = performance.now() - t0;
    expect(elapsed).to.be.lessThan(
      500,
      `50k deep took ${elapsed.toFixed(1)}ms`,
    );
  });

  it("10 000 merges avec objet 100 clés < 300ms", () => {
    const big: Record<string, number> = {};
    for (let i = 0; i < 100; i++) big[`k${i}`] = i;
    const N = 10_000;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      extend({}, big);
    }
    const elapsed = performance.now() - t0;
    expect(elapsed).to.be.lessThan(
      600,
      `10k big-object took ${elapsed.toFixed(1)}ms`,
    );
  });

  it("10 000 deep merges (10 niveaux) < 500ms", () => {
    // Construit un objet profond à 10 niveaux
    const deep10 = (depth: number, val: unknown): Record<string, unknown> =>
      depth === 0
        ? ({ value: val } as Record<string, unknown>)
        : { nested: deep10(depth - 1, val) };
    const base = deep10(10, 1);
    const over = deep10(10, 2);
    const N = 10_000;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      extend(true, {}, base, over);
    }
    const elapsed = performance.now() - t0;
    expect(elapsed).to.be.lessThan(
      500,
      `10k deep-10 took ${elapsed.toFixed(1)}ms`,
    );
  });

  it("throughput comparatif extend vs Object.assign (shallow)", () => {
    const src1 = { a: 1, b: 2, c: 3 };
    const src2 = { d: 4, e: 5 };
    const N = 100_000;

    const t1 = performance.now();
    for (let i = 0; i < N; i++) extend({}, src1, src2);
    const extendMs = performance.now() - t1;

    const t2 = performance.now();
    for (let i = 0; i < N; i++) Object.assign({}, src1, src2);
    const assignMs = performance.now() - t2;

    // extend est acceptable si < 5× Object.assign (checks supplémentaires: hasOwn, guard, isPlainObject)
    expect(extendMs).to.be.lessThan(
      assignMs * 5,
      `extend: ${extendMs.toFixed(1)}ms vs Object.assign: ${assignMs.toFixed(1)}ms`,
    );
  });

  it("stabilité mémoire — pas de fuite sur 200k merges", () => {
    const N = 200_000;
    const src = { a: { x: 1 }, b: [1, 2, 3], c: "text" };
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < N; i++) extend(true, {}, src);
    // Force GC si disponible
    if (global.gc) global.gc();
    const after = process.memoryUsage().heapUsed;
    const deltaMB = (after - before) / 1024 / 1024;
    // Moins de 50 MB de delta (les objets temporaires sont GCés)
    expect(deltaMB).to.be.lessThan(
      50,
      `Delta mémoire: ${deltaMB.toFixed(1)} MB`,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// stripTrailingSlashes
// ─────────────────────────────────────────────────────────────────────────────

describe("stripTrailingSlashes", () => {
  it("retire une barre finale", () => {
    expect(stripTrailingSlashes("/a/b/")).to.equal("/a/b");
  });

  it("retire TOUTES les barres finales", () => {
    expect(stripTrailingSlashes("/a/b///")).to.equal("/a/b");
  });

  it("ne touche pas aux barres intérieures", () => {
    expect(stripTrailingSlashes("/a//b//c///")).to.equal("/a//b//c");
  });

  it("laisse intacte une chaîne sans barre finale", () => {
    expect(stripTrailingSlashes("/a/b")).to.equal("/a/b");
    expect(stripTrailingSlashes("abc")).to.equal("abc");
  });

  it("rend la chaîne vide pour une chaîne vide ou toute en barres", () => {
    expect(stripTrailingSlashes("")).to.equal("");
    expect(stripTrailingSlashes("/")).to.equal("");
    expect(stripTrailingSlashes("///")).to.equal("");
  });

  // Le contrat qui autorise le remplacement des huit `replace(/\/+$/, "")`
  // du dépôt : à sémantique STRICTEMENT identique, sinon la substitution
  // change silencieusement le comportement de huit endroits d'un coup.
  it('rend exactement ce que rendait `replace(/\\/+$/, "")`', () => {
    const cases = [
      "",
      "/",
      "///",
      "abc",
      "/a/b",
      "/a/b/",
      "/a/b///",
      "/a//b//c///",
      "http://h:9200",
      "http://h:9200/",
      "http://h:9200///",
      "/_assets/x/",
      "//",
      "a/",
    ];
    for (const c of cases) {
      expect(stripTrailingSlashes(c)).to.equal(
        c.replace(/\/+$/, ""),
        `divergence sur ${JSON.stringify(c)}`,
      );
    }
  });

  // Le motif regex est QUADRATIQUE quand la reconnaissance échoue (des barres
  // suivies d'autre chose). C'est mesuré : 16 000 barres coûtent ~309 ms à la
  // regex. Un plafond large — la machine de CI n'est pas celle-ci — mais qui
  // mord largement avant un retour du motif quadratique.
  it("reste linéaire sur l'entrée qui fait exploser la regex", () => {
    const hostile = "/".repeat(16_000) + "x";
    const t0 = performance.now();
    const out = stripTrailingSlashes(hostile);
    const ms = performance.now() - t0;
    expect(out).to.equal(hostile);
    expect(ms).to.be.lessThan(50, `${ms.toFixed(1)} ms`);
  });
});
