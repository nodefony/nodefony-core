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

/**
 * RED-TEAM #568 — les délais d'un flux suivent la même borne que le battement :
 * au-delà de 2^31-1 ms Node ramène un minuteur à 1 ms, et une coupure de
 * blocage ou une fin de vie à 1 ms tuerait tout flux. Refusés AVANT de toucher
 * au contexte.
 */
describe("openSseStream — bornes de stallTimeout, maxDuration, maxEventBytes", () => {
  const context = {} as HttpContext;
  for (const name of ["stallTimeout", "maxDuration"] as const) {
    for (const value of [2 ** 31, 0.5, -1, Number.NaN, 0]) {
      it(`${name} ${String(value)} est refusé`, () => {
        expect(() => openSseStream(context, { [name]: value })).to.throw(
          RangeError,
        );
      });
    }
  }
  for (const maxEventBytes of [0, -1, 1.5, Number.NaN]) {
    it(`maxEventBytes ${String(maxEventBytes)} est refusé`, () => {
      expect(() => openSseStream(context, { maxEventBytes })).to.throw(
        RangeError,
      );
    });
  }
});
