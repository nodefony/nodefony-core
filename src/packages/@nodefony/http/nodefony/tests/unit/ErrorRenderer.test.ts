/// <reference types="node" />
import { expect } from "chai";
import "mocha";
import DefaultErrorRenderer from "../../service/error-renderer.js";
import HttpError from "../../src/errors/httpError.js";

// Minimal context shape — DefaultErrorRenderer.renderHttp only touches
// context.metaData. We don't need a real HttpContext here.
function fakeHttpContext(): { metaData: Record<string, unknown> } {
  return {
    metaData: {
      nodefony: {
        requestId: "test-req-id",
        scheme: "https",
      },
      result: null,
    },
  };
}

function fakeWsContext(opts: { rejected: boolean }): { rejected: boolean } {
  return { rejected: opts.rejected };
}

describe("DefaultErrorRenderer — unit tests (P1.5)", () => {
  const renderer = new DefaultErrorRenderer();

  describe("renderHttp", () => {
    it("preserves error code as status when valid", () => {
      const ctx = fakeHttpContext();
      const r = renderer.renderHttp(new HttpError("Forbidden", 403), ctx as never);
      expect(r.status).to.equal(403);
      expect(r.message).to.equal("Forbidden");
    });

    it("normalises code=200 to 500 (legacy quirk)", () => {
      const ctx = fakeHttpContext();
      const r = renderer.renderHttp(new HttpError("oops", 200), ctx as never);
      expect(r.status).to.equal(500);
    });

    it("defaults to 500 when no code", () => {
      const ctx = fakeHttpContext();
      const r = renderer.renderHttp(new Error("plain error"), ctx as never);
      expect(r.status).to.equal(500);
    });

    it("body is the context.metaData (mutated with error/code/message)", () => {
      const ctx = fakeHttpContext();
      const r = renderer.renderHttp(new HttpError("Not Found", 404), ctx as never);
      expect(r.body).to.equal(ctx.metaData);
      const m = ctx.metaData as { code: number; message: string; error: unknown; nodefony: unknown };
      expect(m.code).to.equal(404);
      expect(m.message).to.equal("Not Found");
      expect(m.error).to.be.an("object");
      // legacy contract: requestId stays under nodefony.*
      expect(m.nodefony).to.have.property("requestId", "test-req-id");
    });

    it("wraps native Error into HttpError-like shape with error.toJSON()", () => {
      const ctx = fakeHttpContext();
      renderer.renderHttp(new TypeError("native"), ctx as never);
      const m = ctx.metaData as { error: { message?: string } };
      expect(m.error.message).to.include("native");
    });
  });

  describe("renderWebsocket", () => {
    it("clamps HTTP-style code in connected phase to 1011", () => {
      const ctx = fakeWsContext({ rejected: false });
      const r = renderer.renderWebsocket(new HttpError("server fail", 500), ctx as never);
      expect(r.code).to.equal(1011);
    });

    it("keeps valid WS code in connected phase", () => {
      const ctx = fakeWsContext({ rejected: false });
      const r = renderer.renderWebsocket(new HttpError("policy", 1008), ctx as never);
      expect(r.code).to.equal(1008);
    });

    it("clamps code > 599 to 500 in reject phase", () => {
      const ctx = fakeWsContext({ rejected: true });
      const r = renderer.renderWebsocket(new HttpError("weird", 9999), ctx as never);
      expect(r.code).to.equal(500);
    });

    it("reason carries the error message", () => {
      const ctx = fakeWsContext({ rejected: false });
      const r = renderer.renderWebsocket(new HttpError("custom reason", 1002), ctx as never);
      expect(r.reason).to.equal("custom reason");
    });
  });
});
