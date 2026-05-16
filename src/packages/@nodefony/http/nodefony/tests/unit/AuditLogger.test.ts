/// <reference types="node" />
import { expect } from "chai";
import "mocha";
import JsonAuditLogger, { severityFromStatus } from "../../service/audit-logger.js";

function fakeHttpContext(opts: {
  status?: number;
  url?: string;
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  error?: Error | null;
  phases?: { name: string; startMs: number; endMs?: number; durationMs?: number }[];
} = {}): unknown {
  return {
    url: opts.url ?? "/api/test",
    remoteAddress: "127.0.0.1",
    requestId: "audit-req-id",
    method: opts.method ?? "GET",
    type: "https",
    scheme: "https",
    response: { statusCode: opts.status ?? 200 },
    request: { headers: opts.headers ?? {} },
    error: opts.error ?? null,
    phases: opts.phases ?? [],
    getHost: () => "127.0.0.1:5152",
    getUserAgent: () => "Mozilla/5.0 (test)",
  };
}

describe("severityFromStatus — unit tests (P3.3)", () => {
  it("200 → INFO", () => expect(severityFromStatus(200)).to.equal("INFO"));
  it("301 → INFO", () => expect(severityFromStatus(301)).to.equal("INFO"));
  it("404 → WARNING", () => expect(severityFromStatus(404)).to.equal("WARNING"));
  it("405 → WARNING", () => expect(severityFromStatus(405)).to.equal("WARNING"));
  it("500 → ERROR", () => expect(severityFromStatus(500)).to.equal("ERROR"));
  it("502 → ERROR", () => expect(severityFromStatus(502)).to.equal("ERROR"));
  it("null → INFO", () => expect(severityFromStatus(null)).to.equal("INFO"));
});

describe("JsonAuditLogger — unit tests (P3.1)", () => {
  const logger = new JsonAuditLogger();

  describe("renderHttp", () => {
    it("text is valid JSON", () => {
      const e = logger.renderHttp(fakeHttpContext() as never);
      expect(() => JSON.parse(e.text)).to.not.throw();
    });

    it("msgid is 'audit'", () => {
      const e = logger.renderHttp(fakeHttpContext() as never);
      expect(e.msgid).to.equal("audit");
    });

    it("canonical fields present", () => {
      const e = logger.renderHttp(fakeHttpContext({ status: 200, method: "POST", url: "/x" }) as never);
      const j = JSON.parse(e.text);
      expect(j.requestId).to.equal("audit-req-id");
      expect(j.type).to.equal("http");
      expect(j.scheme).to.equal("https");
      expect(j.method).to.equal("POST");
      expect(j.url).to.equal("/x");
      expect(j.status).to.equal(200);
      expect(j.remoteAddress).to.equal("127.0.0.1");
      expect(j.host).to.equal("127.0.0.1:5152");
      expect(j.userAgent).to.include("test");
      expect(j.ts).to.match(/^\d{4}-\d{2}-\d{2}T/);
      expect(j.userId).to.equal(null);
    });

    it("redacts Authorization / Cookie — presence flags only, no values", () => {
      const e = logger.renderHttp(fakeHttpContext({
        headers: {
          authorization: "Bearer SECRET_TOKEN_DO_NOT_LOG",
          cookie: "session=do-not-log; foo=bar",
        },
      }) as never);
      expect(e.text).to.not.include("SECRET_TOKEN_DO_NOT_LOG");
      expect(e.text).to.not.include("do-not-log");
      const j = JSON.parse(e.text);
      expect(j.hasAuthorization).to.equal(true);
      expect(j.hasCookie).to.equal(true);
    });

    it("absence of redacted headers → flags false", () => {
      const e = logger.renderHttp(fakeHttpContext({ headers: {} }) as never);
      const j = JSON.parse(e.text);
      expect(j.hasAuthorization).to.equal(false);
      expect(j.hasCookie).to.equal(false);
    });

    it("severity follows status (P3.3)", () => {
      expect(logger.renderHttp(fakeHttpContext({ status: 200 }) as never).severity).to.equal("INFO");
      expect(logger.renderHttp(fakeHttpContext({ status: 404 }) as never).severity).to.equal("WARNING");
      expect(logger.renderHttp(fakeHttpContext({ status: 500 }) as never).severity).to.equal("ERROR");
    });

    it("includes phases when present", () => {
      const e = logger.renderHttp(fakeHttpContext({
        phases: [
          { name: "parse", startMs: 100, endMs: 101, durationMs: 1 },
          { name: "resolve", startMs: 101, endMs: 102, durationMs: 1 },
        ],
      }) as never);
      const j = JSON.parse(e.text);
      expect(j.phases).to.be.an("array").with.lengthOf(2);
      expect(j.phases[0].name).to.equal("parse");
      expect(j.phases[0].durationMs).to.equal(1);
    });

    it("omits phases when none recorded (prod timing disabled)", () => {
      const e = logger.renderHttp(fakeHttpContext({ phases: [] }) as never);
      const j = JSON.parse(e.text);
      expect(j.phases).to.equal(undefined);
    });

    it("includes error object on exception", () => {
      const err = new TypeError("boom");
      const e = logger.renderHttp(fakeHttpContext({ status: 500 }) as never, err);
      const j = JSON.parse(e.text);
      expect(j.error).to.deep.include({ name: "TypeError", message: "boom" });
    });
  });

  describe("renderWebsocket", () => {
    it("type is 'ws' and includes protocol", () => {
      const e = logger.renderWebsocket(fakeHttpContext() as never, null, "echo-protocol");
      const j = JSON.parse(e.text);
      expect(j.type).to.equal("ws");
      expect(j.protocol).to.equal("echo-protocol");
    });

    it("error severity ERROR", () => {
      const e = logger.renderWebsocket(fakeHttpContext() as never, new Error("close"), null);
      expect(e.severity).to.equal("ERROR");
    });
  });
});
