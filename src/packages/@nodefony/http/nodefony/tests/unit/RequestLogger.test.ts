/// <reference types="node" />
import { expect } from "chai";
import DefaultRequestLogger from "../../service/request-logger.js";

function fakeHttpContext(
  opts: {
    status?: number;
    env?: string;
    url?: string;
    method?: string;
    error?: Error | null;
  } = {},
): unknown {
  return {
    url: opts.url ?? "/test",
    remoteAddress: "127.0.0.1",
    originUrl: { host: "localhost:5152" },
    requestId: "uuid-1234",
    method: opts.method ?? "GET",
    type: "https",
    response: { statusCode: opts.status ?? 200 },
    kernel: { environment: opts.env ?? "development" },
    error: opts.error ?? null,
  };
}

function fakeWsContext(
  opts: { status?: number; method?: string; url?: string } = {},
): unknown {
  return {
    url: opts.url ?? "/ws",
    remoteAddress: "127.0.0.1",
    originUrl: { host: "localhost:5152" },
    requestId: "ws-uuid-9876",
    method: opts.method ?? "WEBSOCKET",
    type: "websocket",
    response: { statusCode: opts.status ?? 101 },
  };
}

describe("DefaultRequestLogger — unit tests (P1.6)", () => {
  const logger = new DefaultRequestLogger();

  describe("renderHttp", () => {
    it("success → severity INFO, status in msgid, URL/FROM/ID in text", () => {
      const e = logger.renderHttp(fakeHttpContext({ status: 200 }) as never);
      expect(e.severity).to.equal("INFO");
      expect(e.text).to.match(/URL.*\/test/);
      expect(e.text).to.match(/ID.*uuid-1234/);
      expect(e.text).to.match(/FROM.*127\.0\.0\.1/);
    });

    it("error param → severity ERROR, message includes error", () => {
      const e = logger.renderHttp(
        fakeHttpContext({ status: 500 }) as never,
        new Error("kaboom"),
      );
      expect(e.severity).to.equal("ERROR");
      expect(e.text).to.include("kaboom");
    });

    it("falls back to context.error when no explicit error", () => {
      const e = logger.renderHttp(
        fakeHttpContext({ status: 500, error: new Error("ctx-err") }) as never,
      );
      expect(e.severity).to.equal("ERROR");
      expect(e.text).to.include("ctx-err");
    });

    it("prod env → single-line error format (no leading newline)", () => {
      const e = logger.renderHttp(
        fakeHttpContext({ status: 500, env: "prod" }) as never,
        new Error("prod-err"),
      );
      expect(e.text).to.not.include("\n");
    });

    it("dev env → multi-line error format (has newline)", () => {
      const e = logger.renderHttp(
        fakeHttpContext({ status: 500, env: "development" }) as never,
        new Error("dev-err"),
      );
      expect(e.text).to.include("\n");
    });

    it("msgid contains type, status code and method", () => {
      const e = logger.renderHttp(
        fakeHttpContext({ status: 404, method: "POST" }) as never,
      );
      expect(e.msgid).to.match(/https/);
      expect(e.msgid).to.match(/404/);
      expect(e.msgid).to.match(/POST/);
    });
  });

  describe("renderWebsocket", () => {
    it("success → INFO + Accept-Protocol in text", () => {
      const e = logger.renderWebsocket(
        fakeWsContext() as never,
        null,
        "echo-protocol",
      );
      expect(e.severity).to.equal("INFO");
      expect(e.text).to.include("Accept-Protocol");
      expect(e.text).to.include("echo-protocol");
    });

    it("success → wsId (requestId) in text, for correlation (P3.9)", () => {
      const e = logger.renderWebsocket(
        fakeWsContext() as never,
        null,
        "echo-protocol",
      );
      expect(e.text).to.match(/ID.*ws-uuid-9876/);
    });

    it("error → wsId (requestId) in text (P3.9)", () => {
      const e = logger.renderWebsocket(
        fakeWsContext() as never,
        new Error("ws-fail"),
        null,
      );
      expect(e.text).to.match(/ID.*ws-uuid-9876/);
    });

    it("success without protocol → '*' placeholder", () => {
      const e = logger.renderWebsocket(fakeWsContext() as never, null, null);
      // text contains ANSI color codes around the label — match the value only
      expect(e.text).to.match(/Accept-Protocol\S*\s+:\s+\*/);
    });

    it("error → ERROR severity + error toString in text", () => {
      const e = logger.renderWebsocket(
        fakeWsContext() as never,
        new Error("ws-fail"),
        null,
      );
      expect(e.severity).to.equal("ERROR");
      expect(e.text).to.include("ws-fail");
    });
  });
});
