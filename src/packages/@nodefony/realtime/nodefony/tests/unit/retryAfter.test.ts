import { describe, expect, it } from "vitest";
import { retryAfterSeconds } from "../../src/server/RealtimeController";

/**
 * Ce que ce test prouve : l'attente qu'une action pose en `Retry-After`
 * (RFC 9110 §10.2.3 — un délai en secondes OU une date HTTP) arrive au client
 * du pont en secondes, et qu'une valeur illisible ne s'invente pas d'attente.
 */
describe("pont api.request — l'attente d'un `Retry-After`, en secondes", () => {
  const now = Date.parse("2026-11-14T10:00:00Z");

  it("un délai en secondes passe tel quel, espaces autour compris", () => {
    expect(retryAfterSeconds("120", now)).toBe(120);
    expect(retryAfterSeconds(" 7 ", now)).toBe(7);
    expect(retryAfterSeconds("0", now)).toBe(0);
  });

  it("une date HTTP devient l'écart avec maintenant, arrondi au-dessus, jamais négatif", () => {
    expect(retryAfterSeconds("Sat, 14 Nov 2026 10:00:30 GMT", now)).toBe(30);
    expect(retryAfterSeconds("Sat, 14 Nov 2026 09:59:00 GMT", now)).toBe(0);
  });

  it("absent ou illisible : aucune attente inventée", () => {
    expect(retryAfterSeconds(undefined, now)).toBeNull();
    expect(retryAfterSeconds("bientôt", now)).toBeNull();
    expect(retryAfterSeconds("-5", now)).toBeNull();
  });
});
