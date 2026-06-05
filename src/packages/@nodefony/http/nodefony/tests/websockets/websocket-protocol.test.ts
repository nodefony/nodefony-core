import { expect, assert } from "chai";
import WebSocket from "ws";

const WSS = "wss://localhost:5152";
const wsOpts = { rejectUnauthorized: false };

// Route with required protocol "echo-protocol"
const ECHO_PROTO_URL = `${WSS}/nodefony/test/ws/echo/proto`;
// Route with required protocol "json-protocol"
const JSON_PROTO_URL = `${WSS}/nodefony/test/ws/proto/json`;
// Route with NO protocol requirement (accepts anything)
const REFLECT_URL = `${WSS}/nodefony/test/ws/proto/reflect`;
// Route with NO protocol requirement
const ECHO_URL = `${WSS}/nodefony/test/ws/echo`;

function openWs(url: string, protocol?: string | string[]): WebSocket {
  if (protocol) return new WebSocket(url, protocol as string, wsOpts);
  return new WebSocket(url, wsOpts);
}

function wsClose(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) return resolve();
    ws.once("close", () => resolve());
    ws.close(1000);
  });
}

// Wait for close and return the code
function wsCloseCode(ws: WebSocket): Promise<number> {
  return new Promise((resolve, reject) => {
    ws.once("close", (code) => resolve(code));
    ws.once("error", reject);
    ws.once("unexpected-response", () => resolve(0));
  });
}

function wsFirstMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    ws.once("error", reject);
    ws.once("message", (data) => {
      try {
        resolve(JSON.parse(data.toString()));
      } catch (e) {
        reject(e);
      }
    });
  });
}

// ─── Basic Negotiation ────────────────────────────────────────────────────────

describe("WEBSOCKETS PROTOCOL — Basic negotiation", function () {
  it("Correct protocol → route matches, handshake received", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      const ws = openWs(ECHO_PROTO_URL, "echo-protocol");
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        expect(msg.handshake).to.be.true;
        expect(msg.nodefony?.websocket?.protocol).to.equal("echo-protocol");
        ws.close();
      });
      ws.on("close", () => done());
      ws.on("error", done);
    }));

  it("Wrong protocol → close code 1002", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      const ws = openWs(ECHO_PROTO_URL, "wrong-protocol");
      ws.on("close", (code) => {
        expect(code).to.equal(1002);
        done();
      });
      ws.on("error", () => done());
      ws.on("unexpected-response", () => done());
    }));

  it("No protocol when required → close code 1002", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      const ws = openWs(ECHO_PROTO_URL); // no protocol
      ws.on("close", (code) => {
        expect(code).to.equal(1002);
        done();
      });
      ws.on("error", () => done());
      ws.on("unexpected-response", () => done());
    }));

  it("No protocol requirement → accepts connection without protocol", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      const ws = openWs(ECHO_URL);
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        expect(msg.handshake).to.be.true;
        ws.close();
      });
      ws.on("close", () => done());
      ws.on("error", done);
    }));

  it("No protocol requirement → accepts connection WITH unknown protocol", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      const ws = openWs(ECHO_URL, "some-custom-proto");
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        expect(msg.handshake).to.be.true;
        ws.close();
      });
      ws.on("close", () => done());
      ws.on("error", done);
    }));

  it("Protocol reflected in acceptedProtocol via /proto/reflect", async () => {
    const ws = openWs(REFLECT_URL, "my-proto");
    const msg = await wsFirstMessage(ws);
    expect(msg.handshake).to.be.true;
    expect(msg.acceptedProtocol).to.equal("my-proto");
    await wsClose(ws);
  });

  it("No protocol → acceptedProtocol is null", async () => {
    const ws = openWs(REFLECT_URL);
    const msg = await wsFirstMessage(ws);
    expect(msg.handshake).to.be.true;
    expect(msg.acceptedProtocol).to.be.null;
    await wsClose(ws);
  });

  it("Protocol visible in nodefony.websocket.protocol metadata", async () => {
    const ws = openWs(ECHO_PROTO_URL, "echo-protocol");
    const msg = await wsFirstMessage(ws);
    expect(msg.nodefony).to.exist;
    expect((msg.nodefony as any).websocket?.protocol).to.equal("echo-protocol");
    await wsClose(ws);
  });
});

// ─── Array / Multi-protocol ───────────────────────────────────────────────────

describe("WEBSOCKETS PROTOCOL — Array and multi-protocol", function () {
  it("Single-element array ['echo-protocol'] matches required route", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      const ws = new WebSocket(ECHO_PROTO_URL, ["echo-protocol"], wsOpts);
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        expect(msg.handshake).to.be.true;
        ws.close();
      });
      ws.on("close", () => done());
      ws.on("error", done);
    }));

  it("Multi-element array ['wrong', 'echo-protocol'] → header combined → 1002", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      // ws sends "Sec-WebSocket-Protocol: wrong, echo-protocol"
      // Framework does exact string match → "wrong, echo-protocol" ≠ "echo-protocol"
      const ws = new WebSocket(
        ECHO_PROTO_URL,
        ["wrong", "echo-protocol"],
        wsOpts,
      );
      ws.on("close", (code) => {
        expect(code).to.equal(1002);
        done();
      });
      ws.on("error", () => done());
      ws.on("unexpected-response", () => done());
    }));

  it("Two wrong protocols in array → 1002", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      const ws = new WebSocket(ECHO_PROTO_URL, ["proto-a", "proto-b"], wsOpts);
      ws.on("close", (code) => {
        expect(code).to.equal(1002);
        done();
      });
      ws.on("error", () => done());
      ws.on("unexpected-response", () => done());
    }));

  it("Array stored as comma-separated string in acceptedProtocol", async () => {
    const ws = new WebSocket(REFLECT_URL, ["proto-x", "proto-y"], wsOpts);
    const msg = await wsFirstMessage(ws);
    // ws library joins array → "proto-x, proto-y"
    expect(msg.acceptedProtocol).to.equal("proto-x,proto-y");
    await wsClose(ws);
  });
});

// ─── Two distinct protocol routes ─────────────────────────────────────────────

describe("WEBSOCKETS PROTOCOL — Two distinct routes", function () {
  it("echo-protocol route accepts echo-protocol only", async () => {
    const ws = openWs(ECHO_PROTO_URL, "echo-protocol");
    const msg = await wsFirstMessage(ws);
    expect(msg.handshake).to.be.true;
    await wsClose(ws);
  });

  it("json-protocol route accepts json-protocol only", async () => {
    const ws = openWs(JSON_PROTO_URL, "json-protocol");
    const msg = await wsFirstMessage(ws);
    expect(msg.handshake).to.be.true;
    expect((msg as any).protocol).to.equal("json-protocol");
    await wsClose(ws);
  });

  it("echo-protocol rejected on json-protocol route → 1002", async () => {
    const ws = openWs(JSON_PROTO_URL, "echo-protocol");
    const code = await wsCloseCode(ws);
    expect(code).to.equal(1002);
  });

  it("json-protocol rejected on echo-protocol route → 1002", async () => {
    const ws = openWs(ECHO_PROTO_URL, "json-protocol");
    const code = await wsCloseCode(ws);
    expect(code).to.equal(1002);
  });

  it("Concurrent connections on different protocol routes work independently", async () => {
    const wsE = openWs(ECHO_PROTO_URL, "echo-protocol");
    const wsJ = openWs(JSON_PROTO_URL, "json-protocol");
    const [msgE, msgJ] = await Promise.all([
      wsFirstMessage(wsE),
      wsFirstMessage(wsJ),
    ]);
    expect(msgE.handshake).to.be.true;
    expect(msgJ.handshake).to.be.true;
    await Promise.all([wsClose(wsE), wsClose(wsJ)]);
  });

  it("json-protocol route echoes JSON correctly", async () => {
    const ws = openWs(JSON_PROTO_URL, "json-protocol");
    await wsFirstMessage(ws); // handshake
    const payload = { test: "data", num: 42 };
    ws.send(JSON.stringify(payload));
    const reply = await wsFirstMessage(ws);
    expect(reply.test).to.equal("data");
    expect(reply.num).to.equal(42);
    await wsClose(ws);
  });
});

// ─── Protocol Limits ──────────────────────────────────────────────────────────

describe("WEBSOCKETS PROTOCOL — Limits", function () {
  it("Long protocol name (64 chars) on required route → 1002", async () => {
    const longProto = "a".repeat(64);
    const ws = openWs(ECHO_PROTO_URL, longProto);
    const code = await wsCloseCode(ws);
    expect(code).to.equal(1002);
  });

  it("Protocol with dots (e.g. 'v2.json') stored correctly", async () => {
    const ws = openWs(REFLECT_URL, "v2.json");
    const msg = await wsFirstMessage(ws);
    expect(msg.acceptedProtocol).to.equal("v2.json");
    await wsClose(ws);
  });

  it("Protocol with dashes stored correctly", async () => {
    const ws = openWs(REFLECT_URL, "my-app-v1");
    const msg = await wsFirstMessage(ws);
    expect(msg.acceptedProtocol).to.equal("my-app-v1");
    await wsClose(ws);
  });

  it("Protocol with numbers stored correctly", async () => {
    const ws = openWs(REFLECT_URL, "proto-123");
    const msg = await wsFirstMessage(ws);
    expect(msg.acceptedProtocol).to.equal("proto-123");
    await wsClose(ws);
  });

  it("Protocol name with max allowed length (100 chars) stored correctly", async () => {
    const proto = "p" + "-x".repeat(49); // 100 chars
    const ws = openWs(REFLECT_URL, proto);
    const msg = await wsFirstMessage(ws);
    expect(msg.acceptedProtocol).to.equal(proto);
    await wsClose(ws);
  });
});

// ─── Close codes and rapid reconnect ─────────────────────────────────────────

describe("WEBSOCKETS PROTOCOL — Close codes and reconnect", function () {
  it("Protocol violation close code is exactly 1002", async () => {
    const ws = openWs(ECHO_PROTO_URL, "bad-proto");
    const code = await wsCloseCode(ws);
    expect(code).to.equal(1002);
  });

  it("Rapid reconnect after protocol rejection — server stays stable", async () => {
    for (let i = 0; i < 5; i++) {
      const ws = openWs(ECHO_PROTO_URL, "bad-proto");
      const code = await wsCloseCode(ws);
      expect(code).to.equal(1002);
    }
  });

  it("5 concurrent wrong-protocol connections → all get 1002", async () => {
    const N = 5;
    const codes = await Promise.all(
      Array.from({ length: N }, () => {
        const ws = openWs(ECHO_PROTO_URL, "wrong");
        return wsCloseCode(ws);
      }),
    );
    codes.forEach((code) => expect(code).to.equal(1002));
  });

  it("Correct protocol works immediately after rejections", async () => {
    // Trigger some rejections first
    const ws1 = openWs(ECHO_PROTO_URL, "wrong");
    await wsCloseCode(ws1);

    // Then connect correctly
    const ws2 = openWs(ECHO_PROTO_URL, "echo-protocol");
    const msg = await wsFirstMessage(ws2);
    expect(msg.handshake).to.be.true;
    await wsClose(ws2);
  });

  it("Protocol route accepts echo then rejects wrong proto — server not corrupted", async () => {
    // First a good connection
    const ws1 = openWs(ECHO_PROTO_URL, "echo-protocol");
    const msg = await wsFirstMessage(ws1);
    expect(msg.handshake).to.be.true;

    // Then a bad connection
    const ws2 = openWs(ECHO_PROTO_URL, "bad");
    const code = await wsCloseCode(ws2);
    expect(code).to.equal(1002);

    // Then another good connection
    const ws3 = openWs(ECHO_PROTO_URL, "echo-protocol");
    const msg3 = await wsFirstMessage(ws3);
    expect(msg3.handshake).to.be.true;

    await Promise.all([wsClose(ws1), wsClose(ws3)]);
  });
});
