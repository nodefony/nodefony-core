import { expect } from "vitest";
import { isRealtimePayload, realtimePayloadError } from "../realtime/payload";

/**
 * Règle ISOMORPHE de la charge d'un canal (ADR-0021 S1) : la charge devient le
 * `params` d'une notification JSON-RPC 2.0, qui doit être structuré (§4.2).
 */
describe("realtime / isRealtimePayload (charge admise)", () => {
  const cases: ReadonlyArray<readonly [string, unknown, boolean]> = [
    ["absente", undefined, true],
    ["un objet", { v: 1 }, true],
    ["un tableau", [1, 2], true],
    ["des octets", new Uint8Array([1, 2]), true],
    ["un nombre", 42, false],
    ["une chaîne", "hello", false],
    ["un booléen", false, false],
    ["null", null, false],
  ];
  for (const [label, value, admitted] of cases) {
    it(`${label} → ${admitted ? "admise" : "refusée"}`, () => {
      expect(isRealtimePayload(value)).to.equal(admitted);
    });
  }

  it("refuse une fonction (elle ne se sérialise pas)", () => {
    expect(isRealtimePayload(() => {})).to.equal(false);
  });

  it("l'erreur nomme le canal, le type reçu et le geste correctif", () => {
    const err = realtimePayloadError("capteur:temp", null);
    expect(err).to.be.instanceOf(TypeError);
    expect(err.message).to.contain("« capteur:temp »");
    expect(err.message).to.contain("type null");
    expect(err.message).to.contain("{ value }");
  });
});
