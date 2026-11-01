import { describe, expect, it } from "vitest";
import {
  JSON_BYTES_FRAME_CODEC,
  JSON_FRAME_CODEC,
} from "../realtime/jsonFrameCodec";
import { CBOR_FRAME_CODEC } from "../realtime/codec/frameCodec";
import type { IFrameCodec } from "../realtime/IFrameCodec";

/**
 * Ce que ce test prouve : pour CHAQUE codec livré, une frame de chaque forme du
 * protocole revient identique d'un aller-retour — `decode(encode(f)) ≡ f`
 * (ADR-0022 §2a, « refus plutôt que déformation »).
 *
 * Les tests de chaque codec éprouvent des VALEURS (pièges, aléatoire, vecteurs
 * de la RFC) ; aucun ne passait les FRAMES que le protocole émet réellement,
 * dans tous les codecs à la fois. Un codec qui perdrait `id: 0`, un `error.data`
 * ou des octets imbriqués dans une réponse passerait ses propres tests.
 */

const welcome = {
  jsonrpc: "2.0",
  method: "realtime:welcome",
  params: {
    ts: 1770000000000,
    protocol: "jsonrpc-2.0",
    channels: ["chat:room-42"],
    methods: ["chat:history"],
    subscriptionAcks: true,
    identity: {
      type: "anonymous",
      authenticated: false,
      userIdentifier: "anonymous",
      roles: ["ROLE_ANONYMOUS"],
      scopes: [],
    },
    codec: "nodefony.jsonrpc.cbor.v1",
  },
};
const request = {
  jsonrpc: "2.0",
  id: 0,
  method: "chat:history",
  params: { room: "room-42", limit: 50 },
};
const requestStringId = {
  jsonrpc: "2.0",
  id: "c7.12",
  method: "chat:history",
  params: [1, -2.5, null, true],
};
const result = {
  jsonrpc: "2.0",
  id: 1,
  result: { messages: ["salut", "é ✓ 漢"] },
  meta: { requestId: "c7.12" },
};
const error = {
  jsonrpc: "2.0",
  id: 2,
  error: { code: -32000, message: "refusé", data: { status: 409 } },
};
const notification = {
  jsonrpc: "2.0",
  method: "chat:room-42",
  params: { text: "salut", n: 0, neg: -1, big: 2 ** 53 - 1 },
};
const bare = { jsonrpc: "2.0", method: "build:done" };

const TEXT_CORPUS = {
  welcome,
  request,
  requestStringId,
  result,
  error,
  notification,
  bare,
};

// Octets : seuls les codecs qui les portent (CBOR natif, JSON à convention).
const BYTES_CORPUS = {
  ...TEXT_CORPUS,
  bytesPayload: {
    jsonrpc: "2.0",
    method: "capteur:raw",
    params: new Uint8Array([0, 1, 127, 128, 255]),
  },
  nestedBytes: {
    jsonrpc: "2.0",
    method: "doc:42",
    params: {
      seq: 7,
      update: new Uint8Array([9, 8, 7]),
      list: [new Uint8Array(0)],
    },
  },
  bytesInResult: {
    jsonrpc: "2.0",
    id: 3,
    result: { echoed: { data: new Uint8Array([4, 2]) } },
  },
  bytesInErrorData: {
    jsonrpc: "2.0",
    id: 4,
    error: {
      code: -32000,
      message: "refusé",
      data: { raw: new Uint8Array([1]) },
    },
  },
};

function roundTrip(codec: IFrameCodec, frame: unknown): unknown {
  return codec.decode(codec.encode(frame));
}

const CODECS: Array<[string, IFrameCodec, Record<string, unknown>]> = [
  ["JSON natif", JSON_FRAME_CODEC, TEXT_CORPUS],
  ["JSON à convention d'octets", JSON_BYTES_FRAME_CODEC, BYTES_CORPUS],
  ["CBOR", CBOR_FRAME_CODEC, BYTES_CORPUS],
];

describe("Corpus de frames — decode(encode(f)) ≡ f pour chaque codec livré (#618)", () => {
  for (const [name, codec, corpus] of CODECS) {
    for (const [kind, frame] of Object.entries(corpus)) {
      it(`${name} : ${kind}`, () => {
        expect(roundTrip(codec, frame)).toStrictEqual(
          // `toStrictEqual` compare aussi les types : un Uint8Array rendu en
          // objet `{0:…}` ou en `Buffer` est une déformation, pas un égal.
          structuredClone(frame),
        );
      });
    }
  }

  it("des octets relus sont des Uint8Array, jamais des Buffer, dans chaque codec qui les porte", () => {
    for (const codec of [JSON_BYTES_FRAME_CODEC, CBOR_FRAME_CODEC]) {
      const back = roundTrip(codec, BYTES_CORPUS.bytesPayload) as {
        params: Uint8Array;
      };
      expect(Object.getPrototypeOf(back.params)).toBe(Uint8Array.prototype);
    }
  });
});
