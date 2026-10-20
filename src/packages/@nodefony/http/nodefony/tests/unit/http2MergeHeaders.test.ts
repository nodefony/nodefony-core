/// <reference types="node" />
/**
 * Fusion des en-têtes d'une réponse HTTP/2 avant `respond()`.
 *
 * La réponse est une `ServerResponse` RÉELLE de Node : c'est elle qui ramène les
 * noms posés en minuscules (`getHeaderNames`), et la fusion s'appuie sur ce
 * fait au lieu de recopier les en-têtes par `getHeaders()`. Un faux objet
 * prouverait la fusion sur une casse que Node ne rend pas.
 */
import { expect } from "vitest";
import http from "node:http";
import { mergeResponseHeaders } from "../../src/context/http2/Response";

function nodeResponse(): http.ServerResponse {
  return new http.ServerResponse(new http.IncomingMessage(null as never));
}

describe("mergeResponseHeaders — en-têtes posés + en-têtes de writeHead", () => {
  it("même en-tête en deux casses : UNE clé, celle de writeHead gagne", () => {
    // Deux clés `content-type` / `Content-Type` faisaient refuser la réponse
    // par `respond()` (ERR_HTTP2_HEADER_SINGLE_VALUE) : une 500 en HTTP/2.
    const res = nodeResponse();
    res.setHeader("Content-Type", "application/json");
    const merged = mergeResponseHeaders("OK", res, {
      "Content-Type": "text/plain",
    });
    expect(Object.keys(merged).filter((k) => /content-type/i.test(k))).to.eql([
      "content-type",
    ]);
    expect(merged["content-type"]).to.equal("text/plain");
  });

  it("reprend les en-têtes posés, et le message de statut", () => {
    const res = nodeResponse();
    res.setHeader("X-Request-Id", "abc");
    res.setHeader("Set-Cookie", ["a=1", "b=2"]);
    const merged = mergeResponseHeaders("Created", res);
    expect(merged).to.eql({
      "x-status-message": "Created",
      "x-request-id": "abc",
      "set-cookie": ["a=1", "b=2"],
    });
  });

  it("forme plate de writeHead [clé, valeur…], valeurs undefined ignorées", () => {
    const res = nodeResponse();
    res.setHeader("vary", "accept");
    const flat = mergeResponseHeaders("OK", res, ["Vary", "origin"]);
    expect(flat["vary"]).to.equal("origin");
    const withHole = mergeResponseHeaders("OK", res, { "X-Absent": undefined });
    expect(withHole).not.to.have.property("x-absent");
  });
});
