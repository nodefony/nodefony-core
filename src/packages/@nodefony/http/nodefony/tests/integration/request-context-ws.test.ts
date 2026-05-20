/// <reference types="node" />
/**
 * BUG-001 — RequestContext (AsyncLocalStorage) over the WebSocket lifecycle.
 *
 * The ALS bubble is opened by HttpKernel.handleWebsocket() around the
 * handshake. Message/close listeners attached in WebsocketContext.connect()
 * fire on later event-loop ticks — OUTSIDE that bubble — so without the fix
 * (AsyncResource.bind) the requestId/user/traceparent are lost on every
 * message after the handshake.
 *
 * These tests MUST fail before the fix and pass after.
 *
 * Live server: wss://localhost:5152.
 * Routes: src/modules/test/.../AlsController.ts
 *   WS /nodefony/test/als-test/ws       — echoes ALS requestId/user/traceparent
 *   WS /nodefony/test/als-test/ws/user  — "login" sets user, persists to next msg
 */
import { expect } from "chai";
import https from "node:https";
import WebSocket from "ws";
import "mocha";

const WSS = "wss://localhost:5152";
const wsOpts = { rejectUnauthorized: false };

type Json = Record<string, unknown>;

/**
 * Open a socket, then for each subsequent inbound message send the next
 * outbound message (serialized). Returns every JSON message received,
 * starting with the handshake response.
 */
function wsSession(
  path: string,
  messages: string[],
  headers?: Record<string, string>,
): Promise<Json[]> {
  return new Promise((resolve, reject) => {
    const received: Json[] = [];
    const ws = new WebSocket(`${WSS}${path}`, { ...wsOpts, headers });
    let sent = 0;
    ws.on("message", (data: WebSocket.RawData) => {
      try {
        received.push(JSON.parse(data.toString()) as Json);
      } catch (e) {
        ws.terminate();
        return reject(e);
      }
      if (sent < messages.length) {
        ws.send(messages[sent++]);
      } else {
        ws.close();
      }
    });
    ws.on("close", () => resolve(received));
    ws.on("error", reject);
  });
}

describe("BUG-001 — RequestContext (ALS) across WebSocket messages", function () {
  this.timeout(20_000);

  it("requestId survives handshake + 3 messages (all equal, all defined)", async () => {
    const msgs = await wsSession("/nodefony/test/als-test/ws", ["a", "b", "c"]);
    expect(msgs).to.have.length(4); // handshake + 3 responses
    const ids = msgs.map((m) => m.alsRequestId);
    // None must be null (the bug returns null on messages after the handshake)
    ids.forEach((id) => expect(id, "alsRequestId must not be null").to.be.a("string"));
    // All identical across the whole connection
    expect(new Set(ids).size).to.equal(1, "all messages must share one requestId");
    // ALS requestId equals the context's own requestId
    msgs.forEach((m) => expect(m.alsRequestId).to.equal(m.contextRequestId));
  });

  it("isolation: 10 concurrent sockets each keep their own requestId across messages", async () => {
    const sessions = await Promise.all(
      Array.from({ length: 10 }, () =>
        wsSession("/nodefony/test/als-test/ws", ["x", "y"]),
      ),
    );
    const perSocketIds = sessions.map((msgs) => {
      const ids = msgs.map((m) => m.alsRequestId as string);
      ids.forEach((id) => expect(id).to.be.a("string"));
      expect(new Set(ids).size).to.equal(1, "one requestId per socket");
      return ids[0];
    });
    expect(new Set(perSocketIds).size).to.equal(10, "expected 10 distinct requestIds");
  });

  it("user set in one message is visible via ALS in the next message", async () => {
    const msgs = await wsSession("/nodefony/test/als-test/ws/user", ["login", "check"]);
    // [handshake, login-response, check-response]
    expect(msgs).to.have.length(3);
    expect(msgs[0].alsUser, "no user at handshake").to.equal(null);
    expect(msgs[1].alsUser, "user set during 'login' message").to.equal("ws-user-42");
    expect(msgs[2].alsUser, "user persists to the next message").to.equal("ws-user-42");
  });

  it("traceparent from the handshake header is visible on every message", async () => {
    // W3C: the server keeps the incoming trace-id but mints a fresh span-id
    // (it is a child span). So compare the trace-id, not the full header.
    const traceId = "0af7651916cd43dd8448eb211c80319c";
    const tp = `00-${traceId}-b7ad6b7169203331-01`;
    const msgs = await wsSession("/nodefony/test/als-test/ws", ["m1", "m2"], {
      traceparent: tp,
    });
    expect(msgs).to.have.length(3);
    const traceparents = msgs.map((m) => m.alsTraceparent as string);
    traceparents.forEach((t) => {
      expect(t, "traceparent must propagate to messages").to.be.a("string");
      expect(t.split("-")[1], "trace-id must be honored").to.equal(traceId);
    });
    // Same resolved traceparent across the whole connection (ALS propagation).
    expect(new Set(traceparents).size).to.equal(1, "one traceparent per connection");
  });

  it("memory: 100 connections x 10 messages — server heap delta < 25 MB", async function () {
    this.timeout(60_000);
    const before = await serverHeap();
    const batch = Array.from({ length: 10 }, (_, i) => `msg-${i}`);
    for (let i = 0; i < 100; i++) {
      await wsSession("/nodefony/test/als-test/ws", batch);
    }
    const after = await serverHeap();
    const deltaMb = (after - before) / 1024 / 1024;
    expect(after - before).to.be.below(
      25 * 1024 * 1024,
      `heap grew ${deltaMb.toFixed(1)} MB — AsyncResource.bind must not leak`,
    );
  });
});

function serverHeap(): Promise<number> {
  return new Promise((resolve, reject) => {
    const r = https.request(
      { hostname: "localhost", port: 5152, path: "/nodefony/test/memory", method: "GET", rejectUnauthorized: false },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          try {
            resolve((JSON.parse(Buffer.concat(chunks).toString()) as { heapUsed: number }).heapUsed);
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    r.on("error", reject);
    r.end();
  });
}
