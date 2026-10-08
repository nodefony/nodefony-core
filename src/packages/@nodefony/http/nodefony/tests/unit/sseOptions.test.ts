/// <reference types="node" />
import { expect } from "vitest";
import { openSseStream } from "../../src/context/http/SseStream";
import type HttpContext from "../../src/context/http/HttpContext";

/**
 * RED-TEAM V5 — un battement au-delà de 2^31-1 ms, Node le ramène à 1 ms :
 * mille écritures par seconde. Refusé AVANT de toucher au contexte.
 */
describe("openSseStream — bornes de l'option heartbeat", () => {
  const context = {} as HttpContext;
  for (const heartbeat of [
    2 ** 31,
    0.5,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    0,
  ]) {
    it(`heartbeat ${String(heartbeat)} est refusé`, () => {
      expect(() => openSseStream(context, { heartbeat })).to.throw(RangeError);
    });
  }
});
