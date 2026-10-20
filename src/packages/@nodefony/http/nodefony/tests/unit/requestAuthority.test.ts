/// <reference types="node" />
/**
 * Autorité d'une requête : `:authority`, sinon `Host` (RFC 9113 §8.3.1). Le
 * repli couvre la requête qu'un proxy convertit de HTTP/1.1 en HTTP/2 sans
 * fabriquer `:authority` — HAProxy `proto h2` vers un port h2c.
 */
import { expect } from "vitest";
import { requestAuthority } from "../../src/context/transport";

describe("requestAuthority — :authority, sinon Host", () => {
  it("HTTP/2 direct : :authority", () => {
    expect(requestAuthority({ ":authority": "app.example:5153" })).to.equal(
      "app.example:5153",
    );
  });

  it("requête convertie par un proxy : Host seul", () => {
    expect(requestAuthority({ host: "app.example" })).to.equal("app.example");
  });

  it("les deux : :authority prime (RFC 9113 §8.3.1)", () => {
    expect(
      requestAuthority({ ":authority": "a.example", host: "b.example" }),
    ).to.equal("a.example");
  });

  it("aucune autorité : undefined", () => {
    expect(requestAuthority({})).to.equal(undefined);
  });
});
