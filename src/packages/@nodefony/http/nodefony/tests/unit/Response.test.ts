import { expect } from "chai";
import "mocha";
import http from "node:http";
import HttpResponse from "../../src/context/http/Response.js";
import type HttpContext from "../../src/context/http/HttpContext.js";

function makeResponse(): HttpResponse {
  const mockServerResponse = {
    headersSent: false,
    setHeader: () => {},
    getHeaders: () => ({}),
    removeHeader: () => {},
  } as unknown as http.ServerResponse;
  return new HttpResponse(mockServerResponse, {} as HttpContext);
}

describe("HttpResponse — unit tests", () => {
  describe("setStatusCode() — ASCII sanitization (regression ERR_INVALID_CHAR)", () => {
    it("strips em dash (U+2014) from statusMessage", () => {
      const r = makeResponse();
      r.setStatusCode(500, "native error — no HttpError");
      expect(r.statusMessage).to.not.include("—");
      expect(r.statusMessage).to.match(/^[\x20-\x7E]*$/);
    });

    it("strips any non-ASCII char", () => {
      const r = makeResponse();
      r.setStatusCode(400, "mauvais requête");
      expect(r.statusMessage).to.match(/^[\x20-\x7E]*$/);
    });

    it("falls back to standard HTTP text when message is empty after strip", () => {
      const r = makeResponse();
      r.setStatusCode(500, "—–…");
      expect(r.statusMessage).to.equal("Internal Server Error");
    });

    it("leaves plain ASCII message unchanged", () => {
      const r = makeResponse();
      r.setStatusCode(403, "Access Denied");
      expect(r.statusMessage).to.equal("Access Denied");
    });

    it("without message uses standard HTTP status text", () => {
      const r = makeResponse();
      r.setStatusCode(404);
      expect(r.statusMessage).to.equal("Not Found");
    });

  });
});
