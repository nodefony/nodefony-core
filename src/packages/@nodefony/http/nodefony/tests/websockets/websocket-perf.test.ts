import { expect } from "chai";
import WebSocket from "ws";

const WSS = "wss://localhost:5152";
const wsOpts = { rejectUnauthorized: false };

function openWs(url: string): WebSocket {
  return new WebSocket(url, wsOpts);
}

function waitForHandshake(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once("error", reject);
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.handshake === true) resolve();
      } catch {
        reject(new Error("bad handshake"));
      }
    });
  });
}

describe("WEBSOCKETS PERF — Concurrent connections", function () {
  it("10 simultaneous connections open and close cleanly", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      const N = 10;
      const sockets: WebSocket[] = [];
      let opened = 0;
      let closed = 0;

      for (let i = 0; i < N; i++) {
        const ws = openWs(`${WSS}/nodefony/test/ws/echo`);
        sockets.push(ws);

        ws.on("error", done);
        ws.on("message", (data) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.handshake === true) {
              opened++;
              if (opened === N) {
                sockets.forEach((s) => s.close(1000));
              }
            }
          } catch {
            done(new Error("parse error"));
          }
        });
        ws.on("close", () => {
          closed++;
          if (closed === N) done();
        });
      }
    }));

  it("25 simultaneous connections — all receive handshake", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      const N = 25;
      let handshakes = 0;
      let closed = 0;
      const sockets: WebSocket[] = [];

      for (let i = 0; i < N; i++) {
        const ws = openWs(`${WSS}/nodefony/test/ws/echo`);
        sockets.push(ws);
        ws.on("error", done);
        ws.on("message", (data) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.handshake === true) {
              handshakes++;
              ws.close(1000);
            }
          } catch {
            done(new Error("parse error"));
          }
        });
        ws.on("close", () => {
          closed++;
          if (closed === N) {
            expect(handshakes).to.equal(N);
            done();
          }
        });
      }
    }));
});

describe("WEBSOCKETS PERF — Message throughput", function () {
  it("100 sequential messages on one connection — all echoed", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      const ws = openWs(`${WSS}/nodefony/test/ws/echo`);
      const N = 100;
      let received = 0;
      let handshakeDone = false;

      ws.on("error", done);
      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (!handshakeDone) {
            if (msg.handshake === true) {
              handshakeDone = true;
              for (let i = 0; i < N; i++) {
                ws.send(JSON.stringify({ i }));
              }
            }
            return;
          }
          received++;
          if (received === N) {
            expect(received).to.equal(N);
            ws.close(1000);
          }
        } catch {
          done(new Error("parse error"));
        }
      });
      ws.on("close", () => done());
    }));

  it("50 messages × 1 KB — all delivered", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      const ws = openWs(`${WSS}/nodefony/test/ws/echo`);
      const N = 50;
      const chunk = "x".repeat(900);
      let received = 0;
      let handshakeDone = false;

      ws.on("error", done);
      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (!handshakeDone) {
            if (msg.handshake === true) {
              handshakeDone = true;
              for (let i = 0; i < N; i++) {
                ws.send(JSON.stringify({ i, chunk }));
              }
            }
            return;
          }
          received++;
          if (received === N) {
            expect(received).to.equal(N);
            ws.close(1000);
          }
        } catch {
          done(new Error("parse error"));
        }
      });
      ws.on("close", () => done());
    }));
});

describe("WEBSOCKETS PERF — Round-trip latency", function () {
  it("Single round-trip under 500ms", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      const ws = openWs(`${WSS}/nodefony/test/ws/echo`);
      let handshakeDone = false;
      let t0: number;

      ws.on("error", done);
      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (!handshakeDone) {
            if (msg.handshake === true) {
              handshakeDone = true;
              t0 = Date.now();
              ws.send(JSON.stringify({ ping: 1 }));
            }
            return;
          }
          const rtt = Date.now() - t0;
          expect(rtt).to.be.lessThan(500, `RTT ${rtt}ms exceeded 500ms`);
          ws.close(1000);
        } catch {
          done(new Error("parse error"));
        }
      });
      ws.on("close", () => done());
    }));

  it("10 sequential round-trips — avg < 200ms", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      const ws = openWs(`${WSS}/nodefony/test/ws/echo`);
      const N = 10;
      const rtts: number[] = [];
      let handshakeDone = false;
      let t0: number;
      let seq = 0;

      const sendNext = () => {
        if (seq < N) {
          t0 = Date.now();
          ws.send(JSON.stringify({ seq }));
          seq++;
        } else {
          const avg = rtts.reduce((a, b) => a + b, 0) / rtts.length;
          expect(avg).to.be.lessThan(
            200,
            `avg RTT ${avg.toFixed(1)}ms exceeded 200ms`,
          );
          ws.close(1000);
        }
      };

      ws.on("error", done);
      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (!handshakeDone) {
            if (msg.handshake === true) {
              handshakeDone = true;
              sendNext();
            }
            return;
          }
          rtts.push(Date.now() - t0);
          sendNext();
        } catch {
          done(new Error("parse error"));
        }
      });
      ws.on("close", () => done());
    }));
});

describe("WEBSOCKETS PERF — Routing under load", function () {
  it("10 concurrent connections on route variables — all resolve correctly", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      const N = 10;
      let correct = 0;
      let closed = 0;

      for (let i = 0; i < N; i++) {
        const id = `item${i}`;
        const ws = new WebSocket(
          `${WSS}/nodefony/test/ws/routes/${id}`,
          wsOpts,
        );
        ws.on("error", done);
        ws.on("message", (data) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.variables === id) correct++;
            ws.close(1000);
          } catch {
            done(new Error("parse error"));
          }
        });
        ws.on("close", () => {
          closed++;
          if (closed === N) {
            expect(correct).to.equal(
              N,
              `only ${correct}/${N} resolved correctly`,
            );
            done();
          }
        });
      }
    }));

  it("5 concurrent connections on 2-variable route — all resolve correctly", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      const N = 5;
      let correct = 0;
      let closed = 0;

      for (let i = 0; i < N; i++) {
        const v1 = `a${i}`;
        const v2 = `b${i}`;
        const ws = new WebSocket(
          `${WSS}/nodefony/test/ws/routes/${v1}/route2/${v2}`,
          wsOpts,
        );
        ws.on("error", done);
        ws.on("message", (data) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.variables?.var1 === v1 && msg.variables?.var2 === v2)
              correct++;
            ws.close(1000);
          } catch {
            done(new Error("parse error"));
          }
        });
        ws.on("close", () => {
          closed++;
          if (closed === N) {
            expect(correct).to.equal(
              N,
              `only ${correct}/${N} routes resolved correctly`,
            );
            done();
          }
        });
      }
    }));
});
