/// <reference types="node" />
import { expect } from "chai";
import { nextCspNonce } from "../../src/context/Context.js";

// Le cas DISCRIMINANT du pool amorti est l'ÉPUISEMENT : 4096 o / 16 o = 256
// nonces par remplissage — 600 tirages traversent au moins 2 refills. Un pool
// qui ne se re-remplirait pas (ou relirait les mêmes octets) produirait des
// doublons exacts d'un tour à l'autre : l'unicité sur 600 est la preuve.
describe("nextCspNonce — pool CSPRNG amorti (lot B perf)", () => {
  it("600 nonces (≥ 2 refills) : tous uniques, forme base64 de 16 octets", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 600; i++) {
      const n = nextCspNonce();
      // 16 octets → 24 chars base64 avec padding `==`
      expect(n).to.match(/^[A-Za-z0-9+/]{22}==$/);
      seen.add(n);
    }
    expect(seen.size).to.equal(600);
  });
});
