import { expect } from "vitest";
import HttpRequest from "../../src/context/http/Request.js";

/**
 * Red-team #20 (passe 2, code-first) — `charset` du `Content-Type`, choisi par
 * le CLIENT, indexe une table d'alias. Famille de la faille ORM de la passe 1
 * (`?sort=constructor`) : une clé du prototype ne vaut pas `undefined`. Exigé :
 * un encodage Node valide, toujours — jamais une fonction héritée passée à
 * `Buffer.toString`.
 */
describe("red-team — charset hostile du Content-Type", () => {
  const charsetOf = (charset: string | undefined): string =>
    HttpRequest.prototype.getCharset.call({
      rawContentType: { charset },
    } as unknown as HttpRequest);

  it.each([
    "constructor",
    "__proto__",
    "toString",
    "hasOwnProperty",
    "valueOf",
    '"constructor"',
  ])("charset=%s → utf8", (c) => {
    expect(charsetOf(c)).toBe("utf8");
  });

  it("charset inconnu ou absent → utf8", () => {
    expect(charsetOf("x-klingon")).toBe("utf8");
    expect(charsetOf(undefined)).toBe("utf8");
  });

  it("contrôle positif : alias IANA et encodage Node direct", () => {
    expect(charsetOf(" ISO-8859-1 ")).toBe("latin1");
    expect(charsetOf('"utf-8"')).toBe("utf8");
    expect(charsetOf("base64")).toBe("base64");
  });
});
