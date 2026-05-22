/// <reference types="node" />
import { expect } from "chai";
import { toWsCloseCode } from "../../src/context/websocket/WebsocketContext.js";

// Conformité RFC 6455 §7.4 des codes de fermeture WebSocket.
// §7.4.2 : 0-999 « not used » ; 1004/1005/1006/1015 réservés NON émissibles ;
//          3000-3999 frameworks (registrable IANA) ; 4000-4999 privé applicatif.
// §7.4.1 : 1000 normal, 1002 protocole, 1008 policy, 1009 too big, 1011 internal.

describe("toWsCloseCode — coercition RFC 6455 §7.4", () => {
  it("conserve les codes standard émissibles (§7.4.1)", () => {
    for (const c of [1000, 1001, 1002, 1003, 1007, 1008, 1009, 1010, 1011]) {
      expect(toWsCloseCode(c)).to.equal(c);
    }
  });

  it("conserve les codes des plages framework (3xxx) et privé (4xxx)", () => {
    expect(toWsCloseCode(3000)).to.equal(3000);
    expect(toWsCloseCode(3404)).to.equal(3404);
    expect(toWsCloseCode(4004)).to.equal(4004);
    expect(toWsCloseCode(4999)).to.equal(4999);
  });

  it("coerce les réservés NON émissibles (1004/1005/1006/1015/1012) → 1011", () => {
    for (const c of [1004, 1005, 1006, 1012, 1013, 1014, 1015]) {
      expect(toWsCloseCode(c)).to.equal(1011);
    }
  });

  it("HTTP 5xx → 1011 (Internal Error)", () => {
    for (const c of [500, 502, 503, 599]) {
      expect(toWsCloseCode(c)).to.equal(1011);
    }
  });

  it("HTTP 401 / 403 → 1008 (Policy Violation)", () => {
    expect(toWsCloseCode(401)).to.equal(1008);
    expect(toWsCloseCode(403)).to.equal(1008);
  });

  it("autres 4xx (404, 400, 409) → 4004 (privé), JAMAIS 4404", () => {
    expect(toWsCloseCode(404)).to.equal(4004);
    expect(toWsCloseCode(400)).to.equal(4004);
    expect(toWsCloseCode(409)).to.equal(4004);
    // Régression : pas de schéma 4000+code inventé.
    expect(toWsCloseCode(404)).to.not.equal(4404);
  });

  it("plage 0-999 « not used » + hors plage → 1011", () => {
    for (const c of [0, 1, 500 - 500, 999, 5000, 9999, -1]) {
      expect(toWsCloseCode(c)).to.equal(1011);
    }
  });

  it("valeurs non-entières / absentes → 1011", () => {
    expect(toWsCloseCode(undefined)).to.equal(1011);
    expect(toWsCloseCode(null)).to.equal(1011);
    expect(toWsCloseCode(NaN)).to.equal(1011);
    expect(toWsCloseCode(1.5)).to.equal(1011);
  });

  it("toute sortie est un code de fermeture WS émissible valide", () => {
    const isEmittable = (c: number) =>
      c === 1000 ||
      (c >= 1001 && c <= 1003) ||
      (c >= 1007 && c <= 1011) ||
      (c >= 3000 && c <= 4999);
    for (const input of [
      0, 200, 301, 400, 401, 403, 404, 418, 500, 999, 1000, 1006, 1009, 1011,
      1500, 2999, 3000, 4004, 4999, 5000, 70000, -5,
    ]) {
      expect(isEmittable(toWsCloseCode(input))).to.equal(
        true,
        `input ${input} → ${toWsCloseCode(input)} non émissible`,
      );
    }
  });
});
