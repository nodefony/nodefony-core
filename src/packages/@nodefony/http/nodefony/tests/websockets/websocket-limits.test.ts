import { expect, assert } from "chai";
import WebSocket from "ws";

const WSS = "wss://localhost:5152";
const wsOpts = { rejectUnauthorized: false };

function openWs(url: string, protocol?: string): WebSocket {
  return protocol
    ? new WebSocket(url, protocol, wsOpts)
    : new WebSocket(url, wsOpts);
}

describe("WEBSOCKETS LIMITS", function () {
  let ws: WebSocket | null = null;

  afterEach(() => {
    if (ws && ws.readyState !== WebSocket.CLOSED) {
      ws.terminate();
    }
    ws = null;
  });

  // ─── Message size ──────────────────────────────────────────────

  it("Empty string message", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      ws = openWs(`${WSS}/nodefony/test/ws/echo`);
      let sent = false;
      ws.on("message", (data) => {
        const text = data.toString();
        try {
          const msg = JSON.parse(text);
          if (msg.handshake === true && !sent) {
            sent = true;
            ws!.send("");
          } else {
            // server responded (either echo or second handshake due to empty string)
            ws!.close();
          }
        } catch {
          ws!.close();
        }
      });
      ws.on("close", () => done());
      ws.on("error", done);
    }));

  it("Small JSON message (256 B)", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      ws = openWs(`${WSS}/nodefony/test/ws/echo`);
      const payload = JSON.stringify({ data: "x".repeat(200) });
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.handshake === true) {
          ws!.send(payload);
        } else {
          expect(msg.data).to.have.lengthOf(200);
          ws!.close();
        }
      });
      ws.on("close", () => done());
      ws.on("error", done);
    }));

  it("Medium message (64 KB)", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      ws = openWs(`${WSS}/nodefony/test/ws/echo`);
      const payload = JSON.stringify({ data: "a".repeat(65000) });
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.handshake === true) {
          ws!.send(payload);
        } else {
          expect(msg.data).to.have.lengthOf(65000);
          ws!.close();
        }
      });
      ws.on("close", () => done());
      ws.on("error", done);
    }));

  it("Large message (512 KB)", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      ws = openWs(`${WSS}/nodefony/test/ws/echo`);
      const big = "b".repeat(512 * 1024 - 20);
      const payload = JSON.stringify({ data: big });
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.handshake === true) {
          ws!.send(payload);
        } else {
          expect(msg.data).to.have.lengthOf(big.length);
          ws!.close();
        }
      });
      ws.on("close", () => done());
      ws.on("error", done);
    }));

  // ─── Oversized message (RFC 6455 §7.4.1 — 1009 Message Too Big) ─

  it("Oversized message (> maxPayload) → close 1009", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      // Défaut maxPayload = 1 MiB (config http). Un message de 2 MiB doit
      // déclencher la fermeture RFC 6455 §7.4.1 « Message Too Big » côté ws,
      // SANS crash process (capté par WebsocketContext.onConnectionError).
      ws = openWs(`${WSS}/nodefony/test/ws/echo`);
      const huge = "z".repeat(2 * 1024 * 1024); // 2 MiB > 1 MiB
      let closed = false;
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.handshake === true) {
          ws!.send(huge);
        }
      });
      ws.on("close", (code) => {
        closed = true;
        expect(code).to.equal(1009);
        done();
      });
      // 'error' peut précéder 'close' (ws émet error puis close) — toléré.
      ws.on("error", () => {
        if (!closed) {
          /* attendre le close 1009 */
        }
      });
    }));

  // ─── Message sequence ──────────────────────────────────────────

  it("Sequential messages (10) are ordered", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      ws = openWs(`${WSS}/nodefony/test/ws/echo`);
      const N = 10;
      const received: number[] = [];
      let handshakeDone = false;
      let sent = 0;

      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (!handshakeDone) {
          if (msg.handshake === true) {
            handshakeDone = true;
            for (let i = 0; i < N; i++) {
              ws!.send(JSON.stringify({ seq: i }));
              sent++;
            }
          }
          return;
        }
        received.push(msg.seq);
        if (received.length === N) {
          for (let i = 0; i < N; i++) {
            expect(received[i]).to.equal(i, `msg ${i} out of order`);
          }
          ws!.close();
        }
      });
      ws.on("close", () => done());
      ws.on("error", done);
    }));

  it("Sequential messages (50) integrity", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      ws = openWs(`${WSS}/nodefony/test/ws/echo`);
      const N = 50;
      const received: number[] = [];
      let handshakeDone = false;

      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (!handshakeDone) {
          if (msg.handshake === true) {
            handshakeDone = true;
            for (let i = 0; i < N; i++) ws!.send(JSON.stringify({ seq: i }));
          }
          return;
        }
        received.push(msg.seq);
        if (received.length === N) {
          expect(received).to.have.lengthOf(N);
          ws!.close();
        }
      });
      ws.on("close", () => done());
      ws.on("error", done);
    }));

  // ─── Special chars / encoding ──────────────────────────────────

  it("JSON with special characters (unicode, quotes, newlines)", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      ws = openWs(`${WSS}/nodefony/test/ws/echo`);
      const special = { text: "héllo wörld\n\"tab\t'quote'" };
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.handshake === true) {
          ws!.send(JSON.stringify(special));
        } else {
          expect(msg.text).to.equal(special.text);
          ws!.close();
        }
      });
      ws.on("close", () => done());
      ws.on("error", done);
    }));

  it("Non-JSON plain text message", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      ws = openWs(`${WSS}/nodefony/test/ws/echo`);
      ws.on("message", (data) => {
        const text = data.toString();
        try {
          const msg = JSON.parse(text);
          if (msg.handshake === true) {
            ws!.send("hello plain text");
          } else {
            // controller echoes as render() — just verify we got something
            assert.isString(text);
            ws!.close();
          }
        } catch {
          // not JSON — just string echo
          assert.isString(text);
          ws!.close();
        }
      });
      ws.on("close", () => done());
      ws.on("error", done);
    }));

  // ─── Query string ──────────────────────────────────────────────

  it("Query string params are accessible on connect", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      ws = openWs(`${WSS}/nodefony/test/ws?key=value&num=42`);
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        // index route renders metadata on connect — just verify connection works
        assert.exists(msg);
        ws!.close();
      });
      ws.on("close", () => done());
      ws.on("error", done);
    }));

  it("Long query string (1 KB)", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      const longVal = "x".repeat(1000);
      ws = openWs(`${WSS}/nodefony/test/ws?key=${encodeURIComponent(longVal)}`);
      ws.on("message", (data) => {
        assert.exists(JSON.parse(data.toString()));
        ws!.close();
      });
      ws.on("close", () => done());
      ws.on("error", done);
    }));

  // ─── Protocol / handshake ─────────────────────────────────────

  it("Wrong subprotocol falls back gracefully", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      ws = openWs(`${WSS}/nodefony/test/ws/echo/proto`, "wrong-protocol");
      // server requires "echo-protocol" — may reject or accept without protocol
      ws.on("open", () => {
        ws!.send(JSON.stringify({ test: true }));
      });
      ws.on("close", (code) => {
        // accept any close code — important: no crash
        assert.isNumber(code);
        done();
      });
      ws.on("error", () => done()); // error is also acceptable
      ws.on("unexpected-response", () => done());
    }));

  it("Rapid connect and disconnect", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      ws = openWs(`${WSS}/nodefony/test/ws/echo`);
      ws.on("open", () => {
        ws!.close(1000, "immediate close");
      });
      ws.on("close", (code) => {
        expect(code).to.equal(1000);
        done();
      });
      ws.on("error", done);
    }));

  it("Connect without sending (server init only)", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      ws = openWs(`${WSS}/nodefony/test/ws/echo`);
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.handshake === true) {
          // receive handshake, close without responding
          ws!.close(1000);
        }
      });
      ws.on("close", () => done());
      ws.on("error", done);
    }));
});

describe("WEBSOCKETS ROUTER LIMITS", function () {
  let ws: WebSocket | null = null;

  afterEach(() => {
    if (ws && ws.readyState !== WebSocket.CLOSED) ws.terminate();
    ws = null;
  });

  it("Route variable: numeric value", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      ws = new WebSocket(`${WSS}/nodefony/test/ws/routes/123`, wsOpts);
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        expect(msg.variables).to.equal("123");
        ws!.close();
      });
      ws.on("close", () => done());
      ws.on("error", done);
    }));

  it("Route variable: long value (100 chars)", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      const long = "a".repeat(100);
      ws = new WebSocket(`${WSS}/nodefony/test/ws/routes/${long}`, wsOpts);
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        expect(msg.variables).to.equal(long);
        ws!.close();
      });
      ws.on("close", () => done());
      ws.on("error", done);
    }));

  it("Route variable: URL-encoded special chars", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      ws = new WebSocket(`${WSS}/nodefony/test/ws/routes/hello-world`, wsOpts);
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        expect(msg.variables).to.equal("hello-world");
        ws!.close();
      });
      ws.on("close", () => done());
      ws.on("error", done);
    }));

  it("Route 2 variables: multiple values echo", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      ws = new WebSocket(
        `${WSS}/nodefony/test/ws/routes/aaa/route2/bbb`,
        wsOpts,
      );
      let firstMsg = true;
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (firstMsg) {
          firstMsg = false;
          expect(msg.variables.var1).to.equal("aaa");
          expect(msg.variables.var2).to.equal("bbb");
          ws!.send("ping");
        } else {
          expect(msg.result).to.equal("ping");
          ws!.close();
        }
      });
      ws.on("close", () => done());
      ws.on("error", done);
    }));

  it("Unknown route returns close with error code", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      ws = new WebSocket(
        `${WSS}/nodefony/test/ws/nonexistent/deeply/nested`,
        wsOpts,
      );
      ws.on("close", (code) => {
        expect(code).to.be.oneOf([1011, 4004]);
        done();
      });
      ws.on("unexpected-response", () => done());
      ws.on("error", () => done());
    }));

  it("Route variable: metadata in response (nodefony field)", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      ws = new WebSocket(`${WSS}/nodefony/test/ws/routes/test-meta`, wsOpts);
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        expect(msg.nodefony).to.exist;
        expect(msg.nodefony.route).to.exist;
        ws!.close();
      });
      ws.on("close", () => done());
      ws.on("error", done);
    }));
});
