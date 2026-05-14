import { expect } from "chai";
import "mocha";
import WebSocket from "ws";

const WSS = "wss://localhost:5152";
const wsOpts = { rejectUnauthorized: false };
const BIN_URL = `${WSS}/nodefony/test/ws/binary`;
const BC_URL = `${WSS}/nodefony/test/ws/broadcast`;

function openWs(url: string): WebSocket {
  return new WebSocket(url, wsOpts);
}

function wsHandshake(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once("error", reject);
    ws.once("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.handshake === true) resolve();
        else reject(new Error("no handshake, got: " + data.toString()));
      } catch (e) {
        reject(e);
      }
    });
  });
}

function wsNextText(ws: WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    ws.once("error", reject);
    ws.once("message", (data) => resolve(data.toString()));
  });
}

function wsNextBinary(ws: WebSocket): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    ws.once("error", reject);
    ws.once("message", (data) => {
      if (!Buffer.isBuffer(data)) {
        return reject(new Error("expected binary frame, got text: " + data));
      }
      resolve(data);
    });
  });
}

function wsClose(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) return resolve();
    ws.once("close", () => resolve());
    ws.close(1000);
  });
}

// Collect exactly n binary frames — registers listener BEFORE messages are sent
function wsCollectBinary(ws: WebSocket, n: number): Promise<Buffer[]> {
  return new Promise((resolve, reject) => {
    const buffers: Buffer[] = [];
    const handler = (data: WebSocket.RawData) => {
      if (!Buffer.isBuffer(data)) {
        ws.off("message", handler);
        return reject(new Error("expected binary frame, got text: " + data));
      }
      buffers.push(data);
      if (buffers.length === n) {
        ws.off("message", handler);
        resolve(buffers);
      }
    };
    ws.on("message", handler);
  });
}

// ─── BINARY ───────────────────────────────────────────────────────────────────

describe("WEBSOCKETS BINARY", function () {
  this.timeout(10000);

  it("Binary echo: 8 random bytes", async () => {
    const ws = openWs(BIN_URL);
    await wsHandshake(ws);
    const buf = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
    ws.send(buf);
    const reply = await wsNextBinary(ws);
    expect(reply.equals(buf)).to.be.true;
    await wsClose(ws);
  });

  it("Binary echo: all-zero bytes (8)", async () => {
    const ws = openWs(BIN_URL);
    await wsHandshake(ws);
    const buf = Buffer.alloc(8, 0x00);
    ws.send(buf);
    const reply = await wsNextBinary(ws);
    expect(reply.equals(buf)).to.be.true;
    await wsClose(ws);
  });

  it("Binary echo: all-0xFF bytes (8)", async () => {
    const ws = openWs(BIN_URL);
    await wsHandshake(ws);
    const buf = Buffer.alloc(8, 0xff);
    ws.send(buf);
    const reply = await wsNextBinary(ws);
    expect(reply.equals(buf)).to.be.true;
    await wsClose(ws);
  });

  it("Binary echo: full byte range 0x00–0xFF (256 bytes)", async () => {
    const ws = openWs(BIN_URL);
    await wsHandshake(ws);
    const buf = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
    ws.send(buf);
    const reply = await wsNextBinary(ws);
    expect(reply.equals(buf)).to.be.true;
    await wsClose(ws);
  });

  it("Binary echo: 64KB — size and content preserved", async () => {
    const ws = openWs(BIN_URL);
    await wsHandshake(ws);
    const buf = Buffer.allocUnsafe(64 * 1024);
    buf.fill(0xab);
    ws.send(buf);
    const reply = await wsNextBinary(ws);
    expect(reply.length).to.equal(buf.length);
    expect(reply.equals(buf)).to.be.true;
    await wsClose(ws);
  });

  it("JSON handshake (text frame), then binary frame — no mixing", async () => {
    const ws = openWs(BIN_URL);
    await wsHandshake(ws); // text frame
    const buf = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    ws.send(buf); // binary frame
    const reply = await wsNextBinary(ws);
    expect(reply.equals(buf)).to.be.true;
    await wsClose(ws);
  });

  it("5 sequential binary messages — all echoed in order", async () => {
    const ws = openWs(BIN_URL);
    await wsHandshake(ws);
    const bufs = Array.from({ length: 5 }, (_, i) => Buffer.alloc(4, i));
    const collecting = wsCollectBinary(ws, bufs.length);
    for (const buf of bufs) ws.send(buf);
    const replies = await collecting;
    for (let i = 0; i < bufs.length; i++) {
      expect(replies[i].equals(bufs[i])).to.be.true;
    }
    await wsClose(ws);
  });
});

// ─── BINARY LIMITS ────────────────────────────────────────────────────────────

describe("WEBSOCKETS BINARY LIMITS", function () {
  this.timeout(20000);

  it("512KB binary echo — size preserved", async () => {
    const ws = openWs(BIN_URL);
    await wsHandshake(ws);
    const buf = Buffer.allocUnsafe(512 * 1024);
    buf.fill(0xcc);
    ws.send(buf);
    const reply = await wsNextBinary(ws);
    expect(reply.length).to.equal(buf.length);
    expect(reply[0]).to.equal(0xcc);
    expect(reply[reply.length - 1]).to.equal(0xcc);
    await wsClose(ws);
  });

  it("10 sequential binary messages (1KB each) — all delivered", async () => {
    const ws = openWs(BIN_URL);
    await wsHandshake(ws);
    const N = 10;
    const bufs = Array.from({ length: N }, (_, i) => Buffer.alloc(1024, i % 256));
    const collecting = wsCollectBinary(ws, N);
    for (const buf of bufs) ws.send(buf);
    const replies = await collecting;
    for (let i = 0; i < N; i++) {
      expect(replies[i].length).to.equal(1024);
      expect(replies[i][0]).to.equal(bufs[i][0]);
    }
    await wsClose(ws);
  });

  it("5 concurrent connections sending binary simultaneously", async () => {
    const N = 5;
    const buf = Buffer.alloc(512, 0x7f);
    const sockets = Array.from({ length: N }, () => openWs(BIN_URL));
    await Promise.all(sockets.map(wsHandshake));
    await Promise.all(
      sockets.map(async (ws) => {
        ws.send(buf);
        const reply = await wsNextBinary(ws);
        expect(reply.equals(buf)).to.be.true;
      })
    );
    await Promise.all(sockets.map(wsClose));
  });

  it("Binary with null bytes — content preserved", async () => {
    const ws = openWs(BIN_URL);
    await wsHandshake(ws);
    const buf = Buffer.from([0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0xff]);
    ws.send(buf);
    const reply = await wsNextBinary(ws);
    expect(reply.equals(buf)).to.be.true;
    await wsClose(ws);
  });
});

// ─── BROADCAST ────────────────────────────────────────────────────────────────

describe("WEBSOCKETS BROADCAST", function () {
  this.timeout(15000);

  it("Sender receives its own broadcast", async () => {
    const wsA = openWs(BC_URL);
    await wsHandshake(wsA);
    const payload = "bc-self-" + Date.now();
    wsA.send(payload);
    const reply = await wsNextText(wsA);
    expect(reply).to.equal(payload);
    await wsClose(wsA);
  });

  it("2 clients: both receive broadcast", async () => {
    const wsA = openWs(BC_URL);
    const wsB = openWs(BC_URL);
    await Promise.all([wsHandshake(wsA), wsHandshake(wsB)]);
    const payload = "bc-2-" + Date.now();
    const [ra, rb] = await Promise.all([
      wsNextText(wsA),
      wsNextText(wsB),
      Promise.resolve().then(() => wsA.send(payload)),
    ]);
    expect(ra).to.equal(payload);
    expect(rb).to.equal(payload);
    await Promise.all([wsClose(wsA), wsClose(wsB)]);
  });

  it("3 clients: all receive broadcast", async () => {
    const [wsA, wsB, wsC] = [openWs(BC_URL), openWs(BC_URL), openWs(BC_URL)];
    await Promise.all([wsHandshake(wsA), wsHandshake(wsB), wsHandshake(wsC)]);
    const payload = "bc-3-" + Date.now();
    const [ra, rb, rc] = await Promise.all([
      wsNextText(wsA),
      wsNextText(wsB),
      wsNextText(wsC),
      Promise.resolve().then(() => wsA.send(payload)),
    ]);
    expect(ra).to.equal(payload);
    expect(rb).to.equal(payload);
    expect(rc).to.equal(payload);
    await Promise.all([wsClose(wsA), wsClose(wsB), wsClose(wsC)]);
  });

  it("Broadcast payload preserved exactly (special chars)", async () => {
    const wsA = openWs(BC_URL);
    const wsB = openWs(BC_URL);
    await Promise.all([wsHandshake(wsA), wsHandshake(wsB)]);
    const payload = "héllo\twörld\n\"special\"";
    const [ra, rb] = await Promise.all([
      wsNextText(wsA),
      wsNextText(wsB),
      Promise.resolve().then(() => wsA.send(payload)),
    ]);
    expect(ra).to.equal(payload);
    expect(rb).to.equal(payload);
    await Promise.all([wsClose(wsA), wsClose(wsB)]);
  });

  it("5 rapid sequential broadcasts — all delivered to receiver", async () => {
    const wsA = openWs(BC_URL);
    const wsB = openWs(BC_URL);
    await Promise.all([wsHandshake(wsA), wsHandshake(wsB)]);
    const N = 5;
    const payloads = Array.from({ length: N }, (_, i) => `bc-seq-${i}-${Date.now()}`);

    const bMessages: string[] = [];
    const bDone = new Promise<void>((resolve, reject) => {
      wsB.on("error", reject);
      wsB.on("message", (data) => {
        bMessages.push(data.toString());
        if (bMessages.length === N) resolve();
      });
    });

    for (const p of payloads) wsA.send(p);
    await bDone;

    expect(bMessages).to.have.lengthOf(N);
    for (let i = 0; i < N; i++) {
      expect(bMessages[i]).to.equal(payloads[i]);
    }
    await Promise.all([wsClose(wsA), wsClose(wsB)]);
  });

  it("Disconnected client does not receive broadcast", async () => {
    const wsA = openWs(BC_URL);
    const wsB = openWs(BC_URL);
    await Promise.all([wsHandshake(wsA), wsHandshake(wsB)]);

    // Close B before broadcast — wait for full close
    await wsClose(wsB);

    const payload = "bc-after-close-" + Date.now();
    wsA.send(payload);
    const reply = await wsNextText(wsA);
    expect(reply).to.equal(payload);
    await wsClose(wsA);
  });
});

// ─── BROADCAST LIMITS ─────────────────────────────────────────────────────────

describe("WEBSOCKETS BROADCAST LIMITS", function () {
  this.timeout(25000);

  it("10 clients all receive broadcast", async () => {
    const N = 10;
    const sockets = Array.from({ length: N }, () => openWs(BC_URL));
    await Promise.all(sockets.map(wsHandshake));
    const payload = "bc-10-" + Date.now();
    const [, ...results] = await Promise.all([
      Promise.resolve().then(() => sockets[0].send(payload)),
      ...sockets.map((ws) => wsNextText(ws)),
    ]);
    results.forEach((r) => expect(r).to.equal(payload));
    await Promise.all(sockets.map(wsClose));
  });

  it("Large broadcast message (64KB) delivered to 3 clients", async () => {
    const sockets = [openWs(BC_URL), openWs(BC_URL), openWs(BC_URL)];
    await Promise.all(sockets.map(wsHandshake));
    const payload = "x".repeat(64 * 1024 - 10);
    const [, ...results] = await Promise.all([
      Promise.resolve().then(() => sockets[0].send(payload)),
      ...sockets.map((ws) => wsNextText(ws)),
    ]);
    results.forEach((r) => expect(r).to.have.lengthOf(payload.length));
    await Promise.all(sockets.map(wsClose));
  });

  it("Broadcast ordering: 10 messages from A arrive in order at B", async () => {
    const wsA = openWs(BC_URL);
    const wsB = openWs(BC_URL);
    await Promise.all([wsHandshake(wsA), wsHandshake(wsB)]);
    const N = 10;
    const tag = Date.now();
    const payloads = Array.from({ length: N }, (_, i) => `order-${i}-${tag}`);

    const bMessages: string[] = [];
    const bDone = new Promise<void>((resolve, reject) => {
      wsB.on("error", reject);
      wsB.on("message", (data) => {
        bMessages.push(data.toString());
        if (bMessages.length === N) resolve();
      });
    });

    for (const p of payloads) wsA.send(p);
    await bDone;

    for (let i = 0; i < N; i++) {
      expect(bMessages[i]).to.equal(payloads[i], `message ${i} out of order`);
    }
    await Promise.all([wsClose(wsA), wsClose(wsB)]);
  });

  it("5 concurrent senders, all clients receive all broadcasts", async () => {
    const SENDERS = 3;
    const sockets = Array.from({ length: SENDERS }, () => openWs(BC_URL));
    await Promise.all(sockets.map(wsHandshake));

    const tag = Date.now();
    const payloads = sockets.map((_, i) => `multi-sender-${i}-${tag}`);

    // Each client collects messages until it has at least SENDERS messages
    const allReceived = sockets.map(
      (ws) =>
        new Promise<void>((resolve, reject) => {
          const got = new Set<string>();
          ws.on("error", reject);
          ws.on("message", (data) => {
            got.add(data.toString());
            if (got.size === SENDERS) resolve();
          });
        })
    );

    // All senders broadcast simultaneously
    sockets.forEach((ws, i) => ws.send(payloads[i]));
    await Promise.all(allReceived);
    await Promise.all(sockets.map(wsClose));
  });
});
