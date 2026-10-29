import { describe, expect, it } from "vitest";
import { isDeepStrictEqual } from "node:util";
import {
  CBOR_PROTOCOL,
  CborError,
  decodeCbor,
  encodeCbor,
} from "../realtime/codec/index";

/**
 * Codec CBOR face à la RFC 8949 elle-même : les exemples de l'Appendice A (encodage
 * octet pour octet en sérialisation préférée, et décodage), les messages mal formés
 * de l'Appendice F (tous refusés par `CborError`, jamais autrement), les longueurs
 * indéfinies (§3.2) et les bornes contre un message hostile (§10).
 *
 * Écarts VOULUS à l'Appendice A, tous issus de la référence JSON (ADR-0022 §2) : un
 * flottant à valeur entière (`1.0`, `65504.0`, `-4.0`) part en entier — JavaScript ne
 * distingue pas `1` de `1.0`, et JSON écrit `1` ; `-0.0` part en `0` ; `Infinity`/`NaN`
 * partent en `null` ; `undefined` ne part jamais ; les clés d'un objet sont des textes.
 */

const hex = (s: string): Uint8Array =>
  Uint8Array.from(s.replace(/\s+/g, "").match(/../g) ?? [], (b) =>
    parseInt(b, 16),
  );
const toHex = (u8: Uint8Array): string =>
  Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join("");

const refuse = (bytes: Uint8Array): CborError => {
  let caught: unknown = null;
  try {
    decodeCbor(bytes);
  } catch (e) {
    caught = e;
  }
  expect(caught, `octets ${toHex(bytes)} acceptés`).toBeInstanceOf(CborError);
  return caught instanceof CborError ? caught : new CborError("inatteignable");
};

describe("CBOR / RFC 8949 — Appendice A, aller-retour exact (encodage préféré + décodage)", () => {
  const exact: [string, unknown, string][] = [
    ["0", 0, "00"],
    ["1", 1, "01"],
    ["10", 10, "0a"],
    ["23", 23, "17"],
    ["24", 24, "1818"],
    ["25", 25, "1819"],
    ["100", 100, "1864"],
    ["1000", 1000, "1903e8"],
    ["1000000", 1000000, "1a000f4240"],
    ["1000000000000", 1000000000000, "1b000000e8d4a51000"],
    ["-1", -1, "20"],
    ["-10", -10, "29"],
    ["-100", -100, "3863"],
    ["-1000", -1000, "3903e7"],
    ["1.1", 1.1, "fb3ff199999999999a"],
    ["1.5", 1.5, "f93e00"],
    ["3.4028234663852886e+38", 3.4028234663852886e38, "fa7f7fffff"],
    ["1.0e+300", 1.0e300, "fb7e37e43c8800759c"],
    ["5.960464477539063e-8", 5.960464477539063e-8, "f90001"],
    ["0.00006103515625", 0.00006103515625, "f90400"],
    ["-4.1", -4.1, "fbc010666666666666"],
    ["false", false, "f4"],
    ["true", true, "f5"],
    ["null", null, "f6"],
    ["h''", new Uint8Array(0), "40"],
    ["h'01020304'", new Uint8Array([1, 2, 3, 4]), "4401020304"],
    ['""', "", "60"],
    ['"a"', "a", "6161"],
    ['"IETF"', "IETF", "6449455446"],
    ['"\\"\\\\"', '"\\', "62225c"],
    ['"\\u00fc"', "ü", "62c3bc"],
    ['"\\u6c34"', "水", "63e6b0b4"],
    ['"\\ud800\\udd51"', "𐅑", "64f0908591"],
    ["[]", [], "80"],
    ["[1, 2, 3]", [1, 2, 3], "83010203"],
    ["[1, [2, 3], [4, 5]]", [1, [2, 3], [4, 5]], "8301820203820405"],
    [
      "[1..25]",
      Array.from({ length: 25 }, (_, i) => i + 1),
      "98190102030405060708090a0b0c0d0e0f101112131415161718181819",
    ],
    ["{}", {}, "a0"],
    ['{"a": 1, "b": [2, 3]}', { a: 1, b: [2, 3] }, "a26161016162820203"],
    ['["a", {"b": "c"}]', ["a", { b: "c" }], "826161a161626163"],
    [
      '{"a": "A", … "e": "E"}',
      { a: "A", b: "B", c: "C", d: "D", e: "E" },
      "a56161614161626142616361436164614461656145",
    ],
  ];

  for (const [label, value, expected] of exact) {
    it(`${label} ⇄ 0x${expected}`, () => {
      expect(toHex(encodeCbor(value))).toBe(expected);
      expect(isDeepStrictEqual(decodeCbor(hex(expected)), value)).toBe(true);
    });
  }
});

describe("CBOR / RFC 8949 — Appendice A, écarts voulus par la référence JSON", () => {
  const integerValuedFloats: [string, number, string, string][] = [
    // libellé, valeur JS, octets de la RFC (décodage), octets que NOUS émettons (entier)
    ["0.0", 0, "f90000", "00"],
    ["1.0", 1, "f93c00", "01"],
    ["65504.0", 65504, "f97bff", "19ffe0"],
    ["100000.0", 100000, "fa47c35000", "1a000186a0"],
    ["-4.0", -4, "f9c400", "23"],
  ];
  for (const [label, value, rfc, ours] of integerValuedFloats) {
    it(`${label} : la RFC écrit 0x${rfc}, un entier JS part en 0x${ours} ; les deux se relisent`, () => {
      expect(toHex(encodeCbor(value))).toBe(ours);
      expect(decodeCbor(hex(rfc))).toBe(value);
      expect(decodeCbor(hex(ours))).toBe(value);
    });
  }

  it('-0.0 : émis en 0 (JSON écrit « 0 ») ; 0xf98000 se relit -0 (JSON.parse("-0.0") rend -0)', () => {
    expect(toHex(encodeCbor(-0))).toBe("00");
    expect(Object.is(decodeCbor(hex("f98000")), -0)).toBe(true);
  });

  it("18446744073709551615 (0x1bffffffffffffffff) se relit comme le Number le plus proche — celui de JSON.parse", () => {
    expect(decodeCbor(hex("1bffffffffffffffff"))).toBe(
      JSON.parse("18446744073709551615"),
    );
    expect(decodeCbor(hex("3bffffffffffffffff"))).toBe(
      JSON.parse("-18446744073709551616"),
    );
    // -(2^54 + 3) : l'arrondi se fait sur -(n+1), pas sur -1 - arrondi(n) (qui rendrait -2^54).
    expect(decodeCbor(hex("3b0040000000000002"))).toBe(
      JSON.parse("-18014398509481987"),
    );
    expect(decodeCbor(hex("3b0040000000000002"))).not.toBe(-(2 ** 54));
    expect(decodeCbor(hex("1b0040000000000002"))).toBe(
      JSON.parse("18014398509481986"),
    );
    // Le même nombre JS repart en flottant (au-delà de 2^53), jamais en entier 64 bits mensonger.
    expect(toHex(encodeCbor(2 ** 64))).toBe("fa5f800000");
  });

  it("Infinity / NaN / -Infinity en 16, 32 et 64 bits → null ; à l'encodage, null (comme JSON)", () => {
    for (const h of [
      "f97c00",
      "f97e00",
      "f9fc00",
      "fa7f800000",
      "fa7fc00000",
      "faff800000",
      "fb7ff0000000000000",
      "fb7ff8000000000000",
      "fbfff0000000000000",
    ]) {
      expect(decodeCbor(hex(h)), h).toBeNull();
    }
    expect(toHex(encodeCbor(Infinity))).toBe("f6");
    expect(toHex(encodeCbor(NaN))).toBe("f6");
    expect(toHex(encodeCbor(-Infinity))).toBe("f6");
  });

  it("undefined (0xf7) : null à la racine, null dans un tableau, clé omise dans un objet ; refusé à l'encodage en racine", () => {
    expect(decodeCbor(hex("f7"))).toBeNull();
    expect(decodeCbor(hex("82f701"))).toEqual([null, 1]);
    expect(decodeCbor(hex("a26161f76162 02"))).toEqual({ b: 2 });
    expect(() => encodeCbor(undefined)).toThrow(CborError);
  });

  it("{1: 2, 3: 4} (0xa201020304) : clés non textuelles refusées ; l'objet JS {1:2,3:4} a des clés textes", () => {
    expect(refuse(hex("a201020304")).message).toMatch(/non textuelle/);
    expect(toHex(encodeCbor({ 1: 2, 3: 4 }))).toBe("a2613102613304");
  });

  it("étiquettes (type majeur 6) : toutes refusées, même bien formées", () => {
    for (const h of [
      "c074323031332d30332d32315432303a30343a30305a",
      "c11a514b67b0",
      "c1fb41d452d9ec200000",
      "d74401020304",
      "d818456449455446",
      "d82076687474703a2f2f7777772e6578616d706c652e636f6d",
      "c249010000000000000000",
      "c349010000000000000000",
    ]) {
      expect(refuse(hex(h)).message, h).toMatch(/étiquette/);
    }
  });

  it("valeurs simples hors false/true/null/undefined : refusées (simple(16), simple(255))", () => {
    expect(refuse(hex("f0")).message).toMatch(/valeur simple 16/);
    expect(refuse(hex("f8ff")).message).toMatch(/valeur simple 255/);
  });
});

describe("CBOR / RFC 8949 — §3.2 longueurs indéfinies : acceptées au décodage, jamais émises", () => {
  it("(_ h'0102', h'030405') → Uint8Array [1,2,3,4,5], recopié (pas une vue)", () => {
    const input = hex("5f42010243030405ff");
    const out = decodeCbor(input);
    expect(out).toBeInstanceOf(Uint8Array);
    expect(Array.from(out instanceof Uint8Array ? out : [])).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(out instanceof Uint8Array && out.buffer === input.buffer).toBe(
      false,
    );
  });

  it('(_ "strea", "ming") → "streaming"', () => {
    expect(decodeCbor(hex("7f657374726561646d696e67ff"))).toBe("streaming");
  });

  it("tableaux et maps indéfinis, imbriqués dans les deux sens (exemples de l'Appendice A)", () => {
    expect(decodeCbor(hex("9fff"))).toEqual([]);
    expect(decodeCbor(hex("9f018202039f0405ffff"))).toEqual([
      1,
      [2, 3],
      [4, 5],
    ]);
    expect(decodeCbor(hex("9f01820203820405ff"))).toEqual([1, [2, 3], [4, 5]]);
    expect(decodeCbor(hex("83018202039f0405ff"))).toEqual([1, [2, 3], [4, 5]]);
    expect(decodeCbor(hex("83019f0203ff820405"))).toEqual([1, [2, 3], [4, 5]]);
    expect(
      decodeCbor(
        hex("9f0102030405060708090a0b0c0d0e0f101112131415161718181819ff"),
      ),
    ).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    expect(decodeCbor(hex("bf61610161629f0203ffff"))).toEqual({
      a: 1,
      b: [2, 3],
    });
    expect(decodeCbor(hex("826161bf61626163ff"))).toEqual(["a", { b: "c" }]);
    expect(decodeCbor(hex("bf6346756ef563416d7421ff"))).toEqual({
      Fun: true,
      Amt: -2,
    });
  });

  it("un fragment de texte indéfini doit être valide par lui-même (§3.2.3) : un code point coupé en deux est refusé", () => {
    // "ü" = c3 bc, réparti sur deux fragments
    expect(refuse(hex("7f61c361bcff")).message).toMatch(/UTF-8 invalide/);
  });

  it("l'encodeur n'émet jamais de longueur indéfinie", () => {
    const bytes = encodeCbor({
      a: [1, 2, 3],
      b: "texte",
      c: new Uint8Array(5),
    });
    expect(Array.from(bytes).includes(0xff)).toBe(false);
    expect(Array.from(bytes).some((b) => (b & 0x1f) === 31)).toBe(false);
  });
});

describe("CBOR / RFC 8949 — Appendice F : messages mal formés, tous refusés par CborError", () => {
  const malformed: [string, string][] = [
    // fin de l'entrée dans un en-tête
    ...[
      "18",
      "19",
      "1a",
      "1b",
      "1901",
      "1a0102",
      "1b01020304050607",
      "38",
      "58",
      "78",
      "98",
      "9a01ff00",
      "b8",
      "d8",
      "f8",
      "f900",
      "fa0000",
      "fb000000",
    ].map((h): [string, string] => ["fin de l'entrée dans un en-tête", h]),
    // chaînes définies trop courtes
    ...[
      "41",
      "61",
      "5affffffff00",
      "5bffffffffffffffff010203",
      "7affffffff00",
      "7b7fffffffffffffff010203",
    ].map((h): [string, string] => ["chaîne définie trop courte", h]),
    // tableaux / maps définis incomplets
    ...[
      "81",
      "818181818181818181",
      "8200",
      "a1",
      "a20102",
      "a100",
      "a2000000",
    ].map((h): [string, string] => ["tableau ou map défini incomplet", h]),
    ["étiquette sans contenu", "c0"],
    ...["5f4100", "7f6100"].map((h): [string, string] => [
      "chaîne indéfinie sans break",
      h,
    ]),
    ...[
      "9f",
      "9f0102",
      "bf",
      "bf01020102",
      "819f",
      "9f8000",
      "9f9f9f9f9fffffffff",
      "9f819f819f9fffffff",
    ].map((h): [string, string] => ["tableau ou map indéfini sans break", h]),
    // sous-type 1 : information additionnelle réservée
    ...[
      "1c",
      "1d",
      "1e",
      "3c",
      "3d",
      "3e",
      "5c",
      "5d",
      "5e",
      "7c",
      "7d",
      "7e",
      "9c",
      "9d",
      "9e",
      "bc",
      "bd",
      "be",
      "dc",
      "dd",
      "de",
      "fc",
      "fd",
      "fe",
    ].map((h): [string, string] => ["information additionnelle réservée", h]),
    // sous-type 2 : valeurs simples sur deux octets réservées
    ...["f800", "f801", "f818", "f81f"].map((h): [string, string] => [
      "valeur simple sur deux octets < 32",
      h,
    ]),
    // sous-type 3 : fragments de chaîne indéfinie du mauvais type ou non définis
    ...[
      "5f00ff",
      "5f21ff",
      "5f6100ff",
      "5f80ff",
      "5fa0ff",
      "5fc000ff",
      "5fe0ff",
      "7f4100ff",
      "5f5f4100ffff",
      "7f7f6100ffff",
    ].map((h): [string, string] => [
      "fragment de chaîne indéfinie incorrect",
      h,
    ]),
    // sous-type 4 : break hors place
    ...[
      "ff",
      "81ff",
      "8200ff",
      "a1ff",
      "a1ff00",
      "a100ff",
      "a20000ff",
      "9f81ff",
      "9f829f819f9fffffffff",
      "bf00ff",
      "bf000000ff",
    ].map((h): [string, string] => ["break hors place", h]),
    // sous-type 5 : AI 31 sur les types 0, 1, 6
    ...["1f", "3f", "df"].map((h): [string, string] => [
      "longueur indéfinie sur type 0/1/6",
      h,
    ]),
  ];

  for (const [kind, h] of malformed) {
    it(`${kind} — 0x${h}`, () => {
      const err = refuse(hex(h));
      expect(err).toBeInstanceOf(TypeError);
      expect(err.name).toBe("CborError");
      expect(typeof err.position).toBe("number");
      expect(err.message).toMatch(/^CBOR refusé à l'octet \d+ : /);
    });
  }

  it("trop de données : des octets après l'élément racine sont refusés", () => {
    expect(refuse(hex("0102")).message).toMatch(/1 octet\(s\) en trop/);
    expect(refuse(hex("a0 00")).position).toBe(1);
  });

  it("entrée vide : refusée", () => {
    expect(refuse(new Uint8Array(0)).message).toMatch(/fin prématurée/);
  });

  it("toute troncature d'un élément bien formé est refusée (préfixes propres des exemples de l'Appendice A)", () => {
    const wellFormed = [
      "1b000000e8d4a51000",
      "fb3ff199999999999a",
      "64f0908591",
      "98190102030405060708090a0b0c0d0e0f101112131415161718181819",
      "a56161614161626142616361436164614461656145",
      "9f018202039f0405ffff",
      "bf61610161629f0203ffff",
      "5f42010243030405ff",
      "7f657374726561646d696e67ff",
    ];
    for (const h of wellFormed) {
      const full = hex(h);
      for (let n = 0; n < full.length; n++) {
        refuse(full.subarray(0, n));
      }
    }
  });
});

describe("CBOR / RFC 8949 — §10 bornes contre un message hostile", () => {
  it("profondeur : 64 niveaux passent, 65 sont refusés, l'option maxDepth règle le seuil", () => {
    const nested = (levels: number): Uint8Array =>
      hex("81".repeat(levels) + "00");
    expect(decodeCbor(nested(64))).toBeDefined();
    expect(refuse(nested(65)).message).toMatch(/profondeur supérieure à 64/);
    expect(decodeCbor(nested(2), { maxDepth: 2 })).toEqual([[0]]);
    expect(decodeCbor(nested(3))).toEqual([[[0]]]);
    expect(() => decodeCbor(nested(3), { maxDepth: 2 })).toThrow(/profondeur/);
    expect(decodeCbor(nested(500), { maxDepth: 500 })).toBeDefined();
    expect(() => decodeCbor(hex("00"), { maxDepth: 0 })).toThrow(CborError);
    expect(() => decodeCbor(hex("00"), { maxDepth: 1.5 })).toThrow(CborError);
  });

  it("une map compte comme un niveau, au même titre qu'un tableau", () => {
    const nestedMap = (levels: number): Uint8Array =>
      hex("a16161".repeat(levels) + "00");
    expect(decodeCbor(nestedMap(64))).toBeDefined();
    expect(refuse(nestedMap(65)).message).toMatch(/profondeur/);
  });

  it("longueur annoncée confrontée aux octets restants AVANT toute allocation (tableau, map, octets, texte)", () => {
    expect(refuse(hex("9b00000000ffffffff")).message).toMatch(
      /tableau de 4294967295 éléments annoncé/,
    );
    expect(refuse(hex("9a0001000000")).message).toMatch(
      /tableau de 65536 éléments annoncé, 1 octet\(s\) restant/,
    );
    expect(refuse(hex("ba0001000000")).message).toMatch(
      /objet de 65536 entrées annoncé/,
    );
    expect(refuse(hex("5a0001000000")).message).toMatch(
      /chaîne d'octets de 65536 octets annoncée/,
    );
    expect(refuse(hex("7a0001000000")).message).toMatch(
      /texte de 65536 octets annoncé/,
    );
    // une longueur sur 64 bits dont la moitié haute n'est pas nulle : refusée d'emblée
    expect(refuse(hex("5b0000000100000000")).message).toMatch(/hors de portée/);
    expect(refuse(hex("9b0000000100000000")).message).toMatch(/hors de portée/);
  });

  it("budget de préallocation : des tableaux imbriqués qui annoncent chacun « presque tout » sont refusés au total", () => {
    // 98 40 (64 éléments) dont le premier est 98 3e (62 éléments) : chaque longueur tient dans ce qui reste,
    // mais 64 + 62 > 70 octets au total — aucune des deux préallocations ne pourra être remplie.
    const bytes = new Uint8Array(70);
    bytes.set(hex("9840983e"), 0);
    expect(refuse(bytes).message).toMatch(/au total/);
  });

  it("une map annonce plus d'entrées que de paires possibles (2 octets chacune)", () => {
    expect(refuse(hex("a3 0000 0000")).message).toMatch(
      /objet de 3 entrées annoncé, 4 octet\(s\) restant/,
    );
  });

  it("clés en double refusées (§5.6 les autorise ; un objet JS ne peut pas en produire)", () => {
    expect(refuse(hex("a2 6161 01 6161 02")).message).toMatch(
      /clé « a » en double/,
    );
    // la position désigne la clé fautive (octet 4), pas le début de l'objet
    expect(refuse(hex("a2 6161 01 6161 02")).position).toBe(4);
    expect(refuse(hex("bf 6161 01 6161 02 ff")).position).toBe(4);
    // même case de cache (même longueur, deux premiers octets égaux) mais clés différentes : acceptées
    expect(decodeCbor(hex("a2 6461626364 01 6461626365 02"))).toEqual({
      abcd: 1,
      abce: 2,
    });
    // … puis le vrai doublon derrière la collision : refusé
    expect(
      refuse(hex("a3 6461626364 01 6461626365 02 6461626364 03")).message,
    ).toMatch(/en double/);
    // clé longue (hors cache) en double : refusée aussi
    const long = "78 1a" + "61".repeat(26);
    expect(refuse(hex(`a2 ${long} 01 ${long} 02`)).message).toMatch(
      /en double/,
    );
    // map indéfinie : même règle
    expect(refuse(hex("bf 6161 01 6161 02 ff")).message).toMatch(/en double/);
  });

  it("UTF-8 invalide refusé (§5.3.1) : séquence coupée, substitut encodé, forme trop longue", () => {
    expect(refuse(hex("62c328")).message).toMatch(/UTF-8 invalide/);
    expect(refuse(hex("63eda080")).message).toMatch(/UTF-8 invalide/);
    expect(refuse(hex("62c080")).message).toMatch(/UTF-8 invalide/);
    // dans une clé courte aussi
    expect(refuse(hex("a162c32801")).message).toMatch(/UTF-8 invalide/);
  });

  it("une chaîne d'octets est une VUE sur l'entrée (sans copie) ; les octets sont intacts", () => {
    const input = hex("a164646174614403040506");
    const out = decodeCbor(input);
    const data =
      typeof out === "object" && out !== null && "data" in out
        ? out.data
        : null;
    expect(data).toBeInstanceOf(Uint8Array);
    if (data instanceof Uint8Array) {
      expect(data.buffer).toBe(input.buffer);
      expect(Array.from(data)).toEqual([3, 4, 5, 6]);
    }
  });

  it("une clé annoncée plus longue que le reste est refusée AVANT d'être lue (pas une « fin prématurée » après coup)", () => {
    expect(refuse(hex("a1 65 61 62")).message).toMatch(
      /clé de 5 octets annoncée, 2 restant\(s\)/,
    );
  });

  it("une fin de l'entrée dans un en-tête se nomme « fin prématurée » (pas un refus pour une autre raison)", () => {
    for (const h of [
      "18",
      "1901",
      "1a0102",
      "1b01020304050607",
      "f900",
      "fa0000",
      "fb000000",
      "5b00000000",
      "81 1a 00",
    ]) {
      expect(refuse(hex(h)).message, h).toMatch(/fin prématurée/);
    }
  });

  it("valeur simple sur deux octets : < 32 est MAL FORMÉE (§3.3), ≥ 32 est seulement hors profil", () => {
    for (const h of ["f800", "f801", "f818", "f81f"]) {
      expect(refuse(hex(h)).message, h).toMatch(/mal formée/);
    }
    expect(refuse(hex("f820")).message).toMatch(/hors du profil/);
    expect(refuse(hex("f820")).message).not.toMatch(/mal formée/);
  });

  it("UTF-8 : au-delà de U+10FFFF (F4 90.., F5..) refusé, en ligne comme par TextDecoder", () => {
    expect(refuse(hex("64 f4908080")).message).toMatch(/UTF-8 invalide/);
    expect(refuse(hex("64 f5808080")).message).toMatch(/UTF-8 invalide/);
    expect(refuse(hex("64 f8808080")).message).toMatch(/UTF-8 invalide/);
    // la même faute dans un texte long (voie TextDecoder)
    const longBad = "78 48" + "61".repeat(68) + "f4908080";
    expect(refuse(hex(longBad)).message).toMatch(/UTF-8 invalide/);
    // et la borne exacte, acceptée : U+10FFFF
    expect(decodeCbor(hex("64 f48fbfbf"))).toBe("\u{10ffff}");
  });

  it("la position de l'erreur désigne l'octet fautif", () => {
    expect(refuse(hex("83 01 c0 00")).position).toBe(2);
    expect(refuse(hex("a1 01 02")).position).toBe(1);
  });
});

describe("CBOR / sous-protocole", () => {
  it("le nom versionné est celui de l'ADR-0022 §2", () => {
    expect(CBOR_PROTOCOL).toBe("nodefony.jsonrpc.cbor.v1");
  });
});
