import { describe, expect, it } from "vitest";
import * as client from "../client/index";
import * as cbor from "../client/cbor/index";

/**
 * Le codec CBOR vit sur son propre sous-chemin, `nodefony/cbor` : `nodefony/client`, que charge
 * toute page, ne doit pas le tirer (budget de 30 Ko gzip — `.size-budgets.json`).
 */
describe("CBOR / sous-chemin nodefony/cbor", () => {
  it("nodefony/cbor expose exactement le contrat public du codec", () => {
    expect(Object.keys(cbor).sort()).toEqual([
      "CBOR_PROTOCOL",
      "CborError",
      "decodeCbor",
      "encodeCbor",
    ]);
    expect(cbor.CBOR_PROTOCOL).toBe("nodefony.jsonrpc.cbor.v1");
  });

  it("nodefony/client ne réexporte pas le codec", () => {
    for (const name of [
      "encodeCbor",
      "decodeCbor",
      "CborError",
      "CBOR_PROTOCOL",
    ]) {
      expect(Object.hasOwn(client, name)).toBe(false);
    }
  });
});
