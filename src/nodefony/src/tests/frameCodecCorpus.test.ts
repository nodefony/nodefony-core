import { describe, expect, it } from "vitest";
import { JSON_BYTES_FRAME_CODEC } from "../realtime/jsonFrameCodec";
import { CBOR_FRAME_CODEC } from "../realtime/codec/frameCodec";
import type { IFrameCodec } from "../realtime/IFrameCodec";
import { BYTES_CORPUS, SHIPPED_CODECS } from "./fixtures/frameCorpus";

/**
 * Ce que ce test prouve : pour CHAQUE codec livré, une frame de chaque forme du
 * protocole revient identique d'un aller-retour — `decode(encode(f)) ≡ f`
 * (ADR-0022 §2a, « refus plutôt que déformation »).
 *
 * Les tests de chaque codec éprouvent des VALEURS (pièges, aléatoire, vecteurs
 * de la RFC) ; aucun ne passait les FRAMES que le protocole émet réellement,
 * dans tous les codecs à la fois. Un codec qui perdrait `id: 0`, un `error.data`
 * ou des octets imbriqués dans une réponse passerait ses propres tests.
 *
 * L'aller-retour ne voit pas un changement d'octets symétrique (encodé ET relu
 * autrement) : c'est `frameGolden.test.ts` qui fige les octets, sur le même corpus.
 */

function roundTrip(codec: IFrameCodec, frame: unknown): unknown {
  return codec.decode(codec.encode(frame));
}

describe("Corpus de frames — decode(encode(f)) ≡ f pour chaque codec livré (#618)", () => {
  for (const { name, codec, corpus } of SHIPPED_CODECS) {
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
      const back = roundTrip(codec, BYTES_CORPUS.bytesPayload);
      const params =
        typeof back === "object" && back !== null && "params" in back
          ? back.params
          : null;
      expect(params).not.toBe(null);
      expect(Object.getPrototypeOf(params)).toBe(Uint8Array.prototype);
    }
  });
});
