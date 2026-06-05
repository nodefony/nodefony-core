/// <reference types="node" />
import { expect } from "chai";
import PrettyRequestLogger from "../../service/pretty-request-logger.js";

function fakeHttpContext(
  opts: {
    status?: number;
    url?: string;
    method?: string;
    error?: Error | null;
    phases?: {
      name: string;
      startMs: number;
      endMs?: number;
      durationMs?: number;
    }[];
  } = {},
): unknown {
  return {
    url: opts.url ?? "/api/test",
    remoteAddress: "127.0.0.1",
    requestId: "abcdef12-3456-7890-aaaa-bbbbbbbbbbbb",
    method: opts.method ?? "GET",
    response: { statusCode: opts.status ?? 200 },
    phases: opts.phases ?? [],
    error: opts.error ?? null,
  };
}

// Strip ANSI color codes for assertion convenience.
const noColor = (s: string) => s.replace(/\[\d+(;\d+)?m/g, "");

describe("PrettyRequestLogger — unit tests (P3.2)", () => {
  const logger = new PrettyRequestLogger();

  describe("renderHttp", () => {
    it("msgid is 'req'", () => {
      const e = logger.renderHttp(fakeHttpContext() as never);
      expect(e.msgid).to.equal("req");
    });

    it("severity follows status (delegates to severityFromStatus)", () => {
      expect(
        logger.renderHttp(fakeHttpContext({ status: 200 }) as never).severity,
      ).to.equal("INFO");
      expect(
        logger.renderHttp(fakeHttpContext({ status: 404 }) as never).severity,
      ).to.equal("WARNING");
      expect(
        logger.renderHttp(fakeHttpContext({ status: 500 }) as never).severity,
      ).to.equal("ERROR");
    });

    it("includes method, status, url, remote, short requestId", () => {
      const e = logger.renderHttp(
        fakeHttpContext({ method: "POST", status: 201, url: "/foo" }) as never,
      );
      const t = noColor(e.text);
      expect(t).to.include("POST");
      expect(t).to.include("201");
      expect(t).to.include("/foo");
      expect(t).to.include("127.0.0.1");
      // requestId truncated to first 8 chars in brackets
      expect(t).to.include("[abcdef12]");
      // full uuid NOT in the text
      expect(t).to.not.include("bbbbbbbbbbbb");
    });

    it("appends error message when error present", () => {
      const e = logger.renderHttp(
        fakeHttpContext({ status: 500 }) as never,
        new Error("boom-pretty"),
      );
      expect(noColor(e.text)).to.include("boom-pretty");
    });

    it("formats duration when phases recorded", () => {
      // Use real performance.now-based start so duration > 0
      const start = performance.now() - 12.5;
      const e = logger.renderHttp(
        fakeHttpContext({
          phases: [
            { name: "parse", startMs: start, endMs: start + 1, durationMs: 1 },
          ],
        }) as never,
      );
      const t = noColor(e.text);
      expect(t).to.match(/\d+\.\d+ms/);
    });

    it("shows '---' duration when no phases", () => {
      const e = logger.renderHttp(fakeHttpContext({ phases: [] }) as never);
      expect(noColor(e.text)).to.include("---");
    });

    it("output is a single line (no \\n)", () => {
      const e = logger.renderHttp(
        fakeHttpContext({ status: 500 }) as never,
        new Error("multi\nline\nerror"),
      );
      // The logger emits one line — the error.message may contain \n but we
      // only enforce the framing (no extra \n added by the logger itself).
      // Strip the error portion and verify the prefix is single-line.
      const before = e.text.split("multi")[0];
      expect(before).to.not.include("\n");
    });
  });

  describe("renderWebsocket", () => {
    it("prefix is 'WS  '", () => {
      const e = logger.renderWebsocket(fakeHttpContext() as never, null, null);
      expect(noColor(e.text)).to.match(/^WS\s+/);
    });

    it("includes protocol when provided", () => {
      const e = logger.renderWebsocket(
        fakeHttpContext() as never,
        null,
        "echo-protocol",
      );
      expect(noColor(e.text)).to.include("[echo-protocol]");
    });

    it("error severity ERROR", () => {
      const e = logger.renderWebsocket(
        fakeHttpContext() as never,
        new Error("ws-fail"),
        null,
      );
      expect(e.severity).to.equal("ERROR");
      expect(noColor(e.text)).to.include("ws-fail");
    });
  });
});
