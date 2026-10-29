import { describe, expect, it } from "vitest";
import { isDeepStrictEqual } from "node:util";
import { Buffer } from "node:buffer";
import { CborError, decodeCbor, encodeCbor } from "../realtime/codec/index";

/**
 * Codec CBOR face à sa référence : JSON (ADR-0022 §2). Pour toute valeur `v`,
 * `decodeCbor(encodeCbor(v))` doit être profondément égal à `JSON.parse(JSON.stringify(v))`,
 * et lever là où `JSON.stringify` lève. Une seule exception, les octets (`Uint8Array`).
 *
 * Trois volets : une table de valeurs piégées, un générateur déterministe (quelques
 * milliers de valeurs), et des mutations d'octets qui ne doivent JAMAIS planter
 * autrement que par `CborError`.
 */

/** Ce que JSON rend de `v` — ou le refus, pour comparer les deux issues. */
const viaJson = (v: unknown): { ok: true; v: unknown } | { ok: false } => {
  try {
    const text = JSON.stringify(v);
    if (text === undefined) return { ok: false };
    return { ok: true, v: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
};

const viaCbor = (v: unknown): { ok: true; v: unknown } | { ok: false } => {
  try {
    return { ok: true, v: decodeCbor(encodeCbor(v)) };
  } catch (e) {
    expect(e).toBeInstanceOf(CborError);
    return { ok: false };
  }
};

/** Même issue des deux côtés : même valeur (strictement), ou refus des deux. */
const expectAligned = (v: unknown, label?: string): void => {
  const ref = viaJson(v);
  const got = viaCbor(v);
  const what = label ?? JSON.stringify(ref.ok ? ref.v : "refus");
  expect(got.ok, `${what} : JSON ${ref.ok ? "accepte" : "refuse"}`).toBe(
    ref.ok,
  );
  if (ref.ok && got.ok) {
    expect(
      isDeepStrictEqual(got.v, ref.v),
      `${what} : CBOR rend ${JSON.stringify(got.v)}`,
    ).toBe(true);
  }
};

describe("CBOR / référence JSON — table de valeurs piégées", () => {
  const table: [string, unknown][] = [
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["-Infinity", -Infinity],
    ["-0", -0],
    ["-0 dans un tableau", [-0, 0]],
    ["undefined en tableau", [1, undefined, 3]],
    ["undefined en objet", { k: undefined, j: 1 }],
    ["fonction en tableau", [1, () => 1]],
    ["fonction en objet", { f() {}, j: 1 }],
    ["symbole en tableau", [Symbol("s"), 2]],
    ["symbole en objet (valeur)", { s: Symbol("s"), j: 1 }],
    ["clé symbole ignorée", { [Symbol("k")]: 1, j: 2 }],
    ["Date", new Date(0)],
    ["Date invalide", new Date(NaN)],
    ["Date imbriquée", { when: new Date(1700000000000) }],
    ["Map", new Map([["a", 1]])],
    ["Set", new Set([1, 2])],
    ["WeakMap", new WeakMap()],
    ["RegExp", /x/g],
    ["Error", new Error("e")],
    ["Promise", Promise.resolve(1)],
    ["objet sans propriété énumérable", Object.create({ inherited: 1 })],
    [
      "propriété non énumérable ignorée",
      Object.defineProperty({ a: 1 }, "b", { value: 2 }),
    ],
    [
      "accesseur appelé",
      {
        get x() {
          return 42;
        },
      },
    ],
    ["objet à prototype null", Object.assign(Object.create(null), { a: 1 })],
    ["bigint", 10n],
    ["bigint imbriqué", { n: 2n ** 70n }],
    ["BigInt enveloppé", Object(1n)],
    ["Number enveloppé", new Number(5)],
    ["Number enveloppé NaN", { n: new Number(NaN) }],
    ["String enveloppée", new String("x")],
    ["Boolean enveloppé", [new Boolean(false)]],
    ["Symbol enveloppé", Object(Symbol("s"))],
    [
      "imbriqué piégé",
      { a: [NaN, { d: new Date(0), u: undefined, m: new Map() }] },
    ],
    ["tableau creux", [1, , 3]], // eslint-disable-line no-sparse-arrays
    ["tableau creux en fin", Object.assign(new Array(3), { 0: 1 })],
    ["tableau de longueur 0", []],
    [
      "clés numériques et texte (ordre d'Object.keys)",
      { b: 1, 2: 2, a: 3, 1: 4 },
    ],
    ["clé vide", { "": 1 }],
    ["clé numérique négative (texte)", { "-1": 1, "1.5": 2 }],
    ["Int8Array → objet indexé", new Int8Array([1, -2])],
    ["Float64Array → objet indexé", new Float64Array([0.5, 1e300])],
    [
      "Uint8ClampedArray → objet indexé (pas un Uint8Array)",
      new Uint8ClampedArray([1, 2]),
    ],
    ["Uint16Array vide → {}", new Uint16Array(0)],
    ["ArrayBuffer → {}", new ArrayBuffer(8)],
    ["DataView → {}", new DataView(new ArrayBuffer(8))],
    ["toJSON rendant une primitive", { toJSON: () => 7 }],
    ["toJSON rendant une chaîne", { toJSON: () => "sept" }],
    ["toJSON rendant un objet", { toJSON: () => ({ a: [1, 2] }) }],
    ["toJSON rendant undefined à la racine", { toJSON: () => undefined }],
    [
      "toJSON rendant undefined dans un objet",
      { a: { toJSON: () => undefined }, b: 1 },
    ],
    [
      "toJSON rendant undefined dans un tableau",
      [{ toJSON: () => undefined }, 1],
    ],
    [
      "toJSON rendant une Date (pas de second toJSON : {})",
      { toJSON: () => new Date(0) },
    ],
    [
      "toJSON rendant un Number enveloppé (déballé)",
      { toJSON: () => new Number(3) },
    ],
    ["toJSON rendant un bigint (refus)", { toJSON: () => 1n }],
    ["toJSON rendant NaN", { toJSON: () => NaN }],
    ["toJSON non fonction ignoré", { toJSON: 42, a: 1 }],
    [
      "toJSON hérité (prototype)",
      new (class {
        x = 1;
        toJSON() {
          return { y: this.x + 1 };
        }
      })(),
    ],
    ["toJSON reçoit la clé (objet)", { a: { toJSON: (k: string) => k } }],
    ["toJSON reçoit l'index (tableau)", [0, { toJSON: (k: string) => k }]],
    ['toJSON reçoit "" à la racine', { toJSON: (k: string) => `<${k}>` }],
    [
      "entiers aux frontières",
      [
        23, 24, 255, 256, 65535, 65536, 4294967295, 4294967296,
        9007199254740991, -9007199254740991,
      ],
    ],
    [
      "entiers au-delà de 2^53 (flottants)",
      [
        9007199254740992,
        9007199254740994,
        1e21,
        1e300,
        -1e300,
        2 ** 64,
        -(2 ** 64),
      ],
    ],
    [
      "flottants",
      [
        0.1,
        0.5,
        1 / 3,
        Math.PI,
        65505,
        1e-7,
        5e-324,
        -5e-324,
        1.0000001,
        3.4028234663852886e38,
        1.5e-45,
      ],
    ],
    [
      "flottants exacts en 16 bits",
      [1.5, -2.5, 0.00006103515625, 5.960464477539063e-8, 65504.5],
    ],
    ["chaîne vide", ""],
    ["chaîne ASCII 23", "a".repeat(23)],
    ["chaîne ASCII 24", "a".repeat(24)],
    ["chaîne ASCII 64", "a".repeat(64)],
    ["chaîne ASCII 65", "a".repeat(65)],
    ["chaîne ASCII 255", "a".repeat(255)],
    ["chaîne ASCII 256", "a".repeat(256)],
    ["chaîne ASCII 65535", "a".repeat(65535)],
    ["chaîne ASCII 65536", "a".repeat(65536)],
    ["chaîne 2 octets/car qui franchit 24 octets", "é".repeat(12)],
    [
      "chaîne 2 octets/car qui franchit 24 octets, 23 caractères",
      "é".repeat(23),
    ],
    ["chaîne 3 octets/car", "水".repeat(30)],
    ["chaîne 4 octets/car (paires de substituts)", "🎉".repeat(20)],
    ["chaîne 4 octets/car longue", "🎉".repeat(100)],
    [
      "mélange",
      "Été 🎉 — こんにちは, Ελληνικά, \u0000, \u007f, \u0080, ߿, ࠀ, ￿",
    ],
    ["BOM gardé", "﻿abc"],
    ["BOM seul", "﻿"],
    ["caractères de contrôle", "\n\t\r\b\f\u001f"],
    ["clés unicode", { "clé é": 1, 水: 2, "🎉": 3 }],
    ["clé longue", { ["k".repeat(100)]: 1 }],
    ["clé __proto__ propre", JSON.parse('{"__proto__": {"x": 1}, "a": 2}')],
    [
      "clé constructor / toString / hasOwnProperty",
      { constructor: 1, toString: 2, hasOwnProperty: 3 },
    ],
    [
      "objet profond (60 niveaux)",
      Array.from({ length: 60 }).reduce<unknown>((acc) => ({ n: acc }), 0),
    ],
    [
      "tableau profond (60 niveaux)",
      Array.from({ length: 60 }).reduce<unknown>((acc) => [acc], 0),
    ],
    [
      "grand tableau de petits entiers",
      Array.from({ length: 5000 }, (_, i) => i - 2500),
    ],
    [
      "grand objet (300 clés)",
      Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`k${i}`, i])),
    ],
    [
      "objet dont toutes les clés sont omises (en-tête recalculé)",
      Object.fromEntries(
        Array.from({ length: 30 }, (_, i) => [`k${i}`, undefined]),
      ),
    ],
    [
      "objet 30 clés dont 10 omises",
      Object.fromEntries(
        Array.from({ length: 30 }, (_, i) => [
          `k${i}`,
          i % 3 === 0 ? undefined : i,
        ]),
      ),
    ],
    [
      "objet 300 clés dont 290 omises",
      Object.fromEntries(
        Array.from({ length: 300 }, (_, i) => [`k${i}`, i < 10 ? i : () => 1]),
      ),
    ],
    ["Proxy d'objet", new Proxy({ a: 1, b: [2] }, {})],
    ["Proxy de tableau", new Proxy([1, 2, 3], {})],
    [
      "classe avec champs",
      new (class {
        a = 1;
        b = "x";
        get c() {
          return 3;
        }
      })(),
    ],
    [
      "trame JSON-RPC",
      {
        jsonrpc: "2.0",
        id: 7,
        method: "partie:jouer",
        params: {
          coup: "e4",
          joueur: "alice",
          tour: 12,
          horodatage: new Date(0),
        },
      },
    ],
  ];

  for (const [label, value] of table) {
    it(label, () => expectAligned(value, label));
  }

  it("racine undefined / fonction / symbole : JSON.stringify ne rend rien, le codec refuse", () => {
    for (const v of [undefined, () => 1, Symbol("s")]) {
      expect(JSON.stringify(v)).toBeUndefined();
      expect(() => encodeCbor(v)).toThrow(CborError);
    }
  });

  it("bigint et cycle : refusés par CborError, qui est un TypeError (comme JSON.stringify), position null", () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic["self"] = cyclic;
    const inner: unknown[] = [2, [3]];
    const deepCycle: unknown[] = [1, inner];
    inner[1] = deepCycle;
    for (const v of [1n, { n: 1n }, cyclic, deepCycle, [cyclic]]) {
      expect(() => JSON.stringify(v)).toThrow(TypeError);
      let caught: unknown = null;
      try {
        encodeCbor(v);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CborError);
      expect(caught).toBeInstanceOf(TypeError);
      if (caught instanceof CborError) expect(caught.position).toBeNull();
    }
  });

  it("le même objet rencontré deux fois SANS cycle (frère, pas ancêtre) passe, comme en JSON", () => {
    const shared = { x: 1 };
    expectAligned({ a: shared, b: shared, c: [shared, shared] });
  });

  it("un cycle via toJSON est détecté (ancêtre retrouvé après transformation)", () => {
    const holder: Record<string, unknown> = {};
    const wrapper = { again: holder };
    holder["toJSON"] = () => wrapper;
    expect(() => JSON.stringify(holder)).toThrow(TypeError);
    expect(() => encodeCbor(holder)).toThrow(CborError);
  });

  it("substitut UTF-16 isolé : JSON le garde (« \\ud800 »), le codec le remplace par U+FFFD — l'écart assumé", () => {
    // Une chaîne CBOR DOIT être de l'UTF-8 valide (§5.3.1) : un substitut isolé n'y a pas de forme.
    // On fait ce que fait TextEncoder, et ce que ferait une trame texte WebSocket (USVString) au codec JSON.
    for (const s of [
      "\ud800",
      "a\udc00b",
      "\ud800".repeat(30),
      "x".repeat(70) + "\ud83c",
    ]) {
      expect(JSON.parse(JSON.stringify(s))).toBe(s);
      expect(decodeCbor(encodeCbor(s))).toBe(
        s.replace(
          /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g,
          "�",
        ),
      );
    }
  });

  it("un toJSON qui rappelle encodeCbor n'abîme pas l'encodage en cours", () => {
    const inner = { deep: [1, 2, 3] };
    const outer = {
      before: "x".repeat(40),
      nested: { toJSON: () => Array.from(encodeCbor(inner)) },
      after: 2,
    };
    expect(decodeCbor(encodeCbor(outer))).toEqual({
      before: "x".repeat(40),
      nested: Array.from(encodeCbor(inner)),
      after: 2,
    });
  });
});

describe("CBOR / l'exception octets (ADR-0021 S8)", () => {
  it("un Uint8Array voyage en octets et revient en Uint8Array (vue sur l'entrée)", () => {
    const data = new Uint8Array([0, 1, 2, 255]);
    const bytes = encodeCbor({ data });
    const out = decodeCbor(bytes);
    expect(out).toEqual({ data });
    const back =
      typeof out === "object" && out !== null && "data" in out
        ? out.data
        : null;
    expect(back instanceof Uint8Array && back.buffer === bytes.buffer).toBe(
      true,
    );
  });

  it("Buffer (Node) est un Uint8Array : octets, jamais son toJSON {type:'Buffer',data:[…]}", () => {
    const buf = Buffer.from([1, 2, 3]);
    expect(Array.from(encodeCbor(buf))).toEqual([0x43, 1, 2, 3]);
    expect(decodeCbor(encodeCbor({ b: buf }))).toEqual({
      b: new Uint8Array([1, 2, 3]),
    });
  });

  it("une vue décalée sur un tampon plus grand encode ses seuls octets", () => {
    const big = new Uint8Array(64).map((_, i) => i);
    const slice = big.subarray(10, 14);
    expect(Array.from(encodeCbor(slice))).toEqual([0x44, 10, 11, 12, 13]);
  });

  it("grands Uint8Array (copie directe différée) : 4 Ko, 64 Ko, 1 Mo, et plusieurs dans la même trame", () => {
    for (const n of [1023, 1024, 4096, 65536, 1 << 20]) {
      const data = new Uint8Array(n).map((_, i) => i & 0xff);
      const out = decodeCbor(encodeCbor({ id: 1, data, tail: "fin" }));
      expect(out).toEqual({ id: 1, data, tail: "fin" });
    }
    const a = new Uint8Array(2000).fill(1);
    const b = new Uint8Array(3000).fill(2);
    const c = new Uint8Array(10).fill(3);
    expect(decodeCbor(encodeCbor([a, "entre", b, c, { d: a }]))).toEqual([
      a,
      "entre",
      b,
      c,
      { d: a },
    ]);
  });

  it("un résultat n'est JAMAIS réécrit par les encodages suivants (l'arène avance ; les vues ne se recouvrent pas)", () => {
    const first = encodeCbor({ a: 1 });
    const snapshot = Array.from(first);
    const results: Uint8Array[] = [];
    for (let i = 0; i < 20000; i++)
      results.push(encodeCbor({ b: i, s: "x".repeat(i % 50) }));
    expect(Array.from(first)).toEqual(snapshot);
    expect(snapshot).toEqual([0xa1, 0x61, 0x61, 0x01]);
    // Deux vues sur le même tampon sont disjointes ; et chaque résultat se relit tel qu'émis.
    const second = results[0];
    if (second !== undefined && second.buffer === first.buffer) {
      expect(first.byteOffset + first.byteLength).toBeLessThanOrEqual(
        second.byteOffset,
      );
    }
    for (let i = 0; i < results.length; i += 997) {
      const r = results[i];
      if (r !== undefined)
        expect(decodeCbor(r)).toEqual({ b: i, s: "x".repeat(i % 50) });
    }
  });

  it("une trame plus grande que l'arène (32 Ko), puis une géante (> 2 Mo), puis une petite", () => {
    const medium = { t: "x".repeat(40000), u: "é".repeat(20000) };
    expect(decodeCbor(encodeCbor(medium))).toEqual(medium);
    const giant = {
      rows: Array.from({ length: 60000 }, (_, i) => ({
        i,
        s: `ligne ${i}`,
        f: i * 0.5,
      })),
    };
    expect(decodeCbor(encodeCbor(giant), { maxDepth: 8 })).toEqual(giant);
    expect(Array.from(encodeCbor(1))).toEqual([1]);
  });
});

/** Générateur déterministe (mulberry32) — la même graine rejoue la même suite. */
const prng = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789_-:.ÉéàçßÆ水🎉\u0000﻿";
const CODE_POINTS = Array.from(ALPHABET);

const makeGenerator = (seed: number, withBytes: boolean) => {
  const rnd = prng(seed);
  const int = (n: number): number => Math.floor(rnd() * n);
  const str = (): string => {
    const len = int(rnd() < 0.1 ? 120 : 20);
    let s = "";
    for (let i = 0; i < len; i++)
      s += CODE_POINTS[int(CODE_POINTS.length)] ?? "";
    return s;
  };
  const num = (): number => {
    switch (int(10)) {
      case 0:
        return int(24);
      case 1:
        return int(0x100) - 0x80;
      case 2:
        return int(0x10000) * (rnd() < 0.5 ? -1 : 1);
      case 3:
        return Math.floor(rnd() * 2 ** 53) * (rnd() < 0.5 ? -1 : 1);
      case 4:
        return rnd() * 2 ** 64 * (rnd() < 0.5 ? -1 : 1);
      case 5:
        return Math.fround(rnd() * 1000);
      case 6:
        return Math.fround(int(2048) / 1024) * 2 ** (int(30) - 15);
      case 7:
        return (rnd() - 0.5) * 10 ** (int(600) - 300);
      case 8:
        return (
          [NaN, Infinity, -Infinity, -0, 0, 5e-324, 2 ** 53, 2 ** 53 + 2][
            int(8)
          ] ?? 0
        );
      default:
        return rnd() * 1e6;
    }
  };
  const scalar = (): unknown => {
    switch (int(12)) {
      case 0:
        return null;
      case 1:
        return rnd() < 0.5;
      case 2:
        return undefined;
      case 3:
        return new Date(rnd() < 0.1 ? NaN : Math.floor(rnd() * 4e12));
      case 4:
        return rnd() < 0.5 ? new Map([["a", 1]]) : new Set([1]);
      case 5:
        return withBytes && rnd() < 0.5
          ? new Uint8Array(int(40)).map(() => int(256))
          : str();
      case 6:
        return str();
      default:
        return num();
    }
  };
  const value = (depth: number): unknown => {
    const r = rnd();
    if (depth > 5 || r < 0.5) return scalar();
    if (r < 0.75) {
      const n = int(8);
      const a: unknown[] = new Array(n);
      for (let i = 0; i < n; i++) if (rnd() > 0.05) a[i] = value(depth + 1);
      return a;
    }
    const n = int(7);
    const o: Record<string, unknown> = {};
    for (let i = 0; i < n; i++) {
      // Coupe par code point : un substitut isolé n'a pas de forme UTF-8 (écart assumé, testé à part).
      const k =
        rnd() < 0.1
          ? String(int(100))
          : rnd() < 0.02
            ? "__proto__"
            : Array.from(str()).slice(0, 12).join("");
      if (k === "__proto__")
        Object.defineProperty(o, k, {
          value: value(depth + 1),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      else o[k] = value(depth + 1);
    }
    return o;
  };
  return value;
};

/** Remplace les `Uint8Array` par ce que JSON en ferait, pour comparer à la référence. */
const bytesAsJson = (v: unknown): unknown => {
  if (v instanceof Uint8Array)
    return Object.fromEntries(Array.from(v, (b, i) => [String(i), b]));
  if (Array.isArray(v)) return v.map(bytesAsJson);
  if (
    typeof v === "object" &&
    v !== null &&
    !(v instanceof Date) &&
    !(v instanceof Map) &&
    !(v instanceof Set)
  ) {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v)) {
      const e: unknown = Reflect.get(v, k);
      if (k === "__proto__")
        Object.defineProperty(o, k, {
          value: bytesAsJson(e),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      else o[k] = bytesAsJson(e);
    }
    return o;
  }
  return v;
};

describe("CBOR / référence JSON — valeurs aléatoires (graine fixée)", () => {
  it("3000 valeurs sans octets : decodeCbor(encodeCbor(v)) ≡ JSON.parse(JSON.stringify(v))", () => {
    const gen = makeGenerator(20261029, false);
    for (let i = 0; i < 3000; i++) {
      const v = gen(0);
      expectAligned(v, `#${i}`);
    }
  });

  it("1500 valeurs avec octets : les Uint8Array reviennent intacts, le reste suit JSON", () => {
    const gen = makeGenerator(8949, true);
    for (let i = 0; i < 1500; i++) {
      const v = gen(0);
      const ref = viaJson(v);
      const got = viaCbor(v);
      expect(got.ok, `#${i}`).toBe(ref.ok);
      if (ref.ok && got.ok) {
        expect(isDeepStrictEqual(bytesAsJson(got.v), ref.v), `#${i}`).toBe(
          true,
        );
      }
    }
  });

  it("le décodage est idempotent : decode(encode(decode(x))) ≡ decode(x)", () => {
    const gen = makeGenerator(42, true);
    for (let i = 0; i < 500; i++) {
      const v = gen(0);
      let first: unknown;
      try {
        first = decodeCbor(encodeCbor(v));
      } catch {
        continue;
      }
      expect(
        isDeepStrictEqual(decodeCbor(encodeCbor(first)), first),
        `#${i}`,
      ).toBe(true);
    }
  });
});

describe("CBOR / mutations d'octets — jamais un autre plantage que CborError", () => {
  const gen = makeGenerator(777, true);
  const corpus: Uint8Array[] = [];
  for (let i = 0; i < 200; i++) {
    try {
      corpus.push(encodeCbor(gen(0)));
    } catch {
      // bigint, racine undefined : pas de trame
    }
  }
  const rnd = prng(31337);
  const int = (n: number): number => Math.floor(rnd() * n);

  const survives = (bytes: Uint8Array, label: string): void => {
    let out: unknown;
    try {
      out = decodeCbor(bytes);
    } catch (e) {
      expect(e, label).toBeInstanceOf(CborError);
      return;
    }
    // Accepté : le résultat est une valeur du modèle, donc ré-encodable sans faute.
    expect(() => encodeCbor(out), label).not.toThrow();
  };

  it("octets retournés, remplacés, insérés", () => {
    for (let round = 0; round < 3000; round++) {
      const base = corpus[int(corpus.length)];
      if (base === undefined || base.length === 0) continue;
      const m = new Uint8Array(base);
      switch (int(3)) {
        case 0: {
          const at = int(m.length);
          m[at] = (m[at] ?? 0) ^ (1 << int(8));
          break;
        }
        case 1:
          m[int(m.length)] = int(256);
          break;
        default: {
          const at = int(m.length);
          const inserted = new Uint8Array(m.length + 1);
          inserted.set(m.subarray(0, at), 0);
          inserted[at] = int(256);
          inserted.set(m.subarray(at), at + 1);
          survives(inserted, `insertion #${round}`);
          continue;
        }
      }
      survives(m, `mutation #${round}`);
    }
  });

  it("troncature à chaque position, et octets ajoutés", () => {
    for (const base of corpus.slice(0, 60)) {
      for (let n = 0; n < base.length; n++) {
        expect(() => decodeCbor(base.subarray(0, n))).toThrow(CborError);
      }
      const extended = new Uint8Array(base.length + 1);
      extended.set(base, 0);
      expect(() => decodeCbor(extended)).toThrow(CborError);
    }
  });

  it("octets aléatoires purs", () => {
    for (let round = 0; round < 2000; round++) {
      const len = int(40);
      const bytes = new Uint8Array(len).map(() => int(256));
      survives(bytes, `aléatoire #${round}`);
    }
  });
});
