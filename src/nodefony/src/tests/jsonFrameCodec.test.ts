import { describe, expect, it } from "vitest";
import { isDeepStrictEqual } from "node:util";
import { Buffer } from "node:buffer";
import {
  BYTES_MARKER,
  JSON_BYTES_FRAME_CODEC,
  JSON_FRAME_CODEC,
  containsBytes,
} from "../realtime/jsonFrameCodec";
import { JSON_PROTOCOL } from "../realtime/IFrameCodec";
import { fromBase64Url, toBase64Url } from "../realtime/base64url";
import { decodeCbor, encodeCbor } from "../realtime/codec/index";
import { CBOR_FRAME_CODEC } from "../realtime/codec/frameCodec";

/**
 * Codec JSON de la socket (ADR-0022 §2) : une trame sans octets sort EXACTEMENT comme
 * `JSON.stringify` ; un `Uint8Array`, à n'importe quelle profondeur, voyage en
 * `{"$bytes":"<base64url>"}` et revient en `Uint8Array` — la même valeur que celle
 * qu'un client CBOR reçoit du même envoi.
 */

const roundTrip = (v: unknown): unknown =>
  JSON_BYTES_FRAME_CODEC.decode(JSON_BYTES_FRAME_CODEC.encode(v));

describe("base64url sans bourrage (RFC 4648 §5, vecteurs §10)", () => {
  const vectors: Array<[string, string]> = [
    ["", ""],
    ["f", "Zg"],
    ["fo", "Zm8"],
    ["foo", "Zm9v"],
    ["foob", "Zm9vYg"],
    ["fooba", "Zm9vYmE"],
    ["foobar", "Zm9vYmFy"],
  ];
  it.each(vectors)("« %s » ⇄ « %s »", (plain, encoded) => {
    const bytes = new TextEncoder().encode(plain);
    expect(toBase64Url(bytes)).toBe(encoded);
    expect(isDeepStrictEqual(fromBase64Url(encoded), bytes)).toBe(true);
  });

  it("emploie l'alphabet URL : `-` et `_`, jamais `+` ni `/`", () => {
    expect(toBase64Url(new Uint8Array([0xfb, 0xff]))).toBe("-_8");
  });

  it("rend ce que Node rend en base64url, sur 0 à 300 octets", () => {
    for (let n = 0; n <= 300; n++) {
      const bytes = new Uint8Array(n).map((_, i) => (i * 37 + n) & 0xff);
      const expected = Buffer.from(bytes).toString("base64url");
      expect(toBase64Url(bytes)).toBe(expected);
      expect(isDeepStrictEqual(fromBase64Url(expected), bytes)).toBe(true);
    }
  });

  it.each([
    ["A", "longueur impossible"],
    ["Zg==", "bourrage"],
    ["Zm+v", "alphabet standard (+)"],
    ["Zm/v", "alphabet standard (/)"],
    ["Zh", "bits de remplissage non nuls"],
    ["Zm9é", "caractère hors ASCII"],
  ])("refuse « %s » (%s)", (text) => {
    expect(() => fromBase64Url(text)).toThrow(TypeError);
  });
});

describe.each([
  ["JSON_FRAME_CODEC", JSON_FRAME_CODEC],
  ["JSON_BYTES_FRAME_CODEC", JSON_BYTES_FRAME_CODEC],
] as const)("%s — trame sans octets", (_name, codec) => {
  it("annonce le sous-protocole texte `nodefony.jsonrpc.v1`", () => {
    expect(codec.protocol).toBe(JSON_PROTOCOL);
    expect(JSON_PROTOCOL).toBe("nodefony.jsonrpc.v1");
  });

  it("sort octet pour octet comme JSON.stringify", () => {
    const frame = {
      jsonrpc: "2.0",
      method: "doc:42",
      params: {
        rev: 7,
        tags: ["a", { b: [1, 2, { c: null }] }],
        at: new Date(0),
      },
    };
    expect(codec.encode(frame)).toBe(JSON.stringify(frame));
  });

  it("relit ce que JSON.parse relit, valeurs piégées comprises", () => {
    const values: unknown[] = [
      { n: NaN, i: Infinity, z: -0, d: new Date(0), m: new Map([[1, 2]]) },
      [undefined, () => 1, Symbol("s")],
      { s: new Set([1]), nested: { u: undefined } },
    ];
    for (const v of values) {
      expect(codec.decode(codec.encode(v))).toEqual(
        JSON.parse(JSON.stringify(v)),
      );
    }
  });

  it("lève là où JSON.stringify lève (bigint, cycle)", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => codec.encode({ big: 1n })).toThrow(TypeError);
    expect(() => codec.encode(cyclic)).toThrow(TypeError);
  });

  it("refuse une trame binaire : ce codec ne lit que du texte", () => {
    expect(() => codec.decode(new Uint8Array([1]))).toThrow(TypeError);
  });
});

describe("JSON_BYTES_FRAME_CODEC — octets (ADR-0021 S8, ADR-0022 §3)", () => {
  const delta = new Uint8Array([1, 2, 255]);

  it("porte un Uint8Array imbriqué sous le marqueur `$bytes`", () => {
    const text = JSON_BYTES_FRAME_CODEC.encode({
      method: "doc:42",
      params: { rev: 7, delta },
    });
    expect(text).toBe(
      `{"method":"doc:42","params":{"rev":7,"delta":{"${BYTES_MARKER}":"AQL_"}}}`,
    );
  });

  it("rend un Uint8Array à l'arrivée, à toute profondeur", () => {
    const sent = {
      params: delta,
      deep: [{ a: { b: [delta, { c: delta }] } }],
      empty: new Uint8Array(0),
    };
    const got = roundTrip(sent);
    expect(isDeepStrictEqual(got, sent)).toBe(true);
  });

  it("traite un Buffer de Node comme des octets (sous-classe de Uint8Array)", () => {
    const got = roundTrip({ b: Buffer.from([9, 8]) });
    expect(isDeepStrictEqual(got, { b: new Uint8Array([9, 8]) })).toBe(true);
  });

  it("rend la MÊME valeur qu'un client CBOR qui reçoit le même envoi", () => {
    const sent = {
      jsonrpc: "2.0",
      method: "doc:42",
      params: { rev: 7, delta },
    };
    const viaJson = roundTrip(sent);
    const viaCbor = decodeCbor(encodeCbor(sent));
    expect(isDeepStrictEqual(viaJson, viaCbor)).toBe(true);
  });

  it("laisse un objet applicatif dont le marqueur n'est pas SEUL ou pas une chaîne", () => {
    const text =
      `{"a":{"${BYTES_MARKER}":"AQL_","x":1},"b":{"${BYTES_MARKER}":3},` +
      `"c":"${BYTES_MARKER}"}`;
    expect(JSON_BYTES_FRAME_CODEC.decode(text)).toEqual({
      a: { [BYTES_MARKER]: "AQL_", x: 1 },
      b: { [BYTES_MARKER]: 3 },
      c: BYTES_MARKER,
    });
  });

  it("refuse un marqueur dont le base64url est invalide (entrée réseau)", () => {
    expect(() =>
      JSON_BYTES_FRAME_CODEC.decode(`{"d":{"${BYTES_MARKER}":"Zm+v"}}`),
    ).toThrow(TypeError);
  });
});

describe("containsBytes — le parcours qui décide du chemin lent", () => {
  it("trouve des octets à n'importe quelle profondeur", () => {
    expect(containsBytes({ a: [{ b: { c: [new Uint8Array(1)] } }] })).toBe(
      true,
    );
    expect(containsBytes(new Uint8Array(0))).toBe(true);
  });

  it("ne voit rien dans une charge sans octets, ni dans un autre tableau typé", () => {
    expect(containsBytes({ a: [1, "x", { b: null }], d: new Date() })).toBe(
      false,
    );
    expect(containsBytes({ f: new Float32Array(2) })).toBe(false);
    expect(containsBytes(undefined)).toBe(false);
  });

  it("s'arrête sur une structure circulaire au lieu de boucler", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(containsBytes(cyclic)).toBe(false);
  });
});

describe("JSON_FRAME_CODEC — le défaut ne parcourt rien (ADR-0022 §2, décision du 2026-10-31)", () => {
  it("rend des octets imbriqués tels que JSON.stringify les rend : sans convention", () => {
    const frame = { params: { delta: new Uint8Array([1, 2]) } };
    expect(JSON_FRAME_CODEC.encode(frame)).toBe(JSON.stringify(frame));
    expect(JSON_FRAME_CODEC.encode(frame)).not.toContain(BYTES_MARKER);
  });

  it("ne réanime pas un marqueur `$bytes` reçu : seule l'activation du binaire l'arme", () => {
    const got = JSON_FRAME_CODEC.decode(`{"d":{"${BYTES_MARKER}":"AQL_"}}`);
    expect(got).toEqual({ d: { [BYTES_MARKER]: "AQL_" } });
  });

  // Preuve de la décision (option écartée : « réanimer `$bytes` par défaut au
  // décodage, derrière un `includes` ») : sur le fil d'un serveur SANS codec, un
  // objet applicatif qui porte ce nom changerait de nature, ou ferait jeter la
  // trame entière. Le défaut ne peut donc pas réanimer : seule une annonce du
  // serveur (champ `bytes` de l'accueil) dit que la convention est armée.
  it("réanimer par défaut altérerait le fil d'un serveur sans codec : valeur changée ou trame jetée", () => {
    const applicative = `{"d":{"${BYTES_MARKER}":"AQL_"}}`;
    const unreadable = `{"d":{"${BYTES_MARKER}":"pas de l'octet !"}}`;
    // Ce que l'application a émis, et ce que le défaut lui rend.
    expect(JSON_FRAME_CODEC.decode(applicative)).toEqual({
      d: { [BYTES_MARKER]: "AQL_" },
    });
    expect(JSON_FRAME_CODEC.decode(unreadable)).toEqual({
      d: { [BYTES_MARKER]: "pas de l'octet !" },
    });
    // La même trame sous la convention : un objet devient des octets…
    expect(JSON_BYTES_FRAME_CODEC.decode(applicative)).toEqual({
      d: new Uint8Array([1, 2, 255]),
    });
    // … et une chaîne quelconque fait refuser toute la trame.
    expect(() => JSON_BYTES_FRAME_CODEC.decode(unreadable)).toThrow(TypeError);
  });
});

describe("CBOR_FRAME_CODEC — la frame en CBOR, et la même valeur à l'arrivée", () => {
  const frame = {
    jsonrpc: "2.0",
    method: "doc:42",
    params: { rev: 7, delta: new Uint8Array([1, 2, 255]), at: new Date(0) },
  };

  it("annonce `nodefony.jsonrpc.cbor.v1` et émet une trame binaire", () => {
    expect(CBOR_FRAME_CODEC.protocol).toBe("nodefony.jsonrpc.cbor.v1");
    expect(CBOR_FRAME_CODEC.encode(frame)).toBeInstanceOf(Uint8Array);
  });

  it("rend ce que le codec JSON à octets rend du même envoi", () => {
    const viaCbor = CBOR_FRAME_CODEC.decode(CBOR_FRAME_CODEC.encode(frame));
    const viaText = JSON_BYTES_FRAME_CODEC.decode(
      JSON_BYTES_FRAME_CODEC.encode(frame),
    );
    expect(isDeepStrictEqual(viaCbor, viaText)).toBe(true);
  });

  it("lit une trame TEXTE en JSON, convention des octets comprise (l'accueil reste `v1`)", () => {
    const text = JSON_BYTES_FRAME_CODEC.encode(frame);
    expect(
      isDeepStrictEqual(
        CBOR_FRAME_CODEC.decode(text),
        JSON_BYTES_FRAME_CODEC.decode(text),
      ),
    ).toBe(true);
  });
});

describe("JSON_BYTES_FRAME_CODEC — un marqueur FORGÉ est refusé à l'émission (#618, ADR-0022 §2)", () => {
  const forged = (marker: string) => ({
    jsonrpc: "2.0",
    method: "chat",
    params: { note: { [BYTES_MARKER]: marker } },
  });

  it("sans octets dans la charge : l'objet qui a la forme exacte du marqueur lève, en nommant sa clé", () => {
    expect(() => JSON_BYTES_FRAME_CODEC.encode(forged("AAEC"))).toThrow(
      /non issu d'octets sous la clé "note"/,
    );
    // Une chaîne invalide aurait fait jeter la trame chez chaque abonné texte.
    expect(() => JSON_BYTES_FRAME_CODEC.encode(forged("!!!"))).toThrow(
      TypeError,
    );
  });

  it("à côté de vrais octets : les octets passent, le forgé lève quand même", () => {
    const frame = {
      params: { real: new Uint8Array([1]), ...forged("AAEC").params },
    };
    expect(() => JSON_BYTES_FRAME_CODEC.encode(frame)).toThrow(
      /sous la clé "note"/,
    );
  });

  it("le message ne recopie jamais la valeur forgée", () => {
    let message = "";
    try {
      JSON_BYTES_FRAME_CODEC.encode(forged("SECRET-VALUE"));
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).not.toContain("SECRET-VALUE");
  });

  it("un `toJSON` qui rend la forme du marqueur est refusé aussi : c'est le texte émis qui compte", () => {
    const sneaky = { toJSON: () => ({ [BYTES_MARKER]: "AAEC" }) };
    expect(() => JSON_BYTES_FRAME_CODEC.encode({ params: { sneaky } })).toThrow(
      TypeError,
    );
  });

  it("ce que le récepteur garde en objet passe intact : marqueur accompagné, non chaîne, ou simple texte", () => {
    const frame = {
      a: { [BYTES_MARKER]: "AAEC", x: 1 },
      b: { [BYTES_MARKER]: 3 },
      c: `il a écrit "${BYTES_MARKER}" dans le salon`,
      d: [BYTES_MARKER],
    };
    const text = JSON_BYTES_FRAME_CODEC.encode(frame);
    // Octet pour octet ce que JSON.stringify rend, et relu à l'identique.
    expect(text).toBe(JSON.stringify(frame));
    expect(JSON_BYTES_FRAME_CODEC.decode(text)).toEqual(frame);
  });

  it("le codec JSON natif n'est pas concerné : sans convention, rien n'est réanimé, rien n'est refusé", () => {
    expect(JSON_FRAME_CODEC.encode(forged("AAEC"))).toBe(
      JSON.stringify(forged("AAEC")),
    );
  });
});
