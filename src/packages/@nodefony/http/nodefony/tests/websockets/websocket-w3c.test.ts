import { expect } from "chai";
import "mocha";
import WebSocket from "ws";

const wsOpts = { rejectUnauthorized: false };

describe("WEBSOCKETS W3C ", () => {
  let ws: WebSocket | null = null;

  afterEach(async () => {
    if (ws && ws.readyState !== WebSocket.CLOSED) {
      ws.terminate();
    }
    ws = null;
  });

  it("W3C websocket 404", (done) => {
    ws = new WebSocket(
      "wss://localhost:5152/nodefony/test/wsu?foo=bar&bar=foo",
      wsOpts
    );
    ws.on("unexpected-response", () => {
      done();
    });
    ws.on("error", () => {});
    ws.onclose = function () {
      done();
    };
  });

  it("W3C websocket", (done) => {
    ws = new WebSocket(
      "wss://localhost:5152/nodefony/test/ws?foo=bar&bar=foo",
      wsOpts
    );
    ws.onerror = function () {};
    ws.onopen = function () {
      const number = Math.round(Math.random() * 0xffffff);
      ws?.send(number.toString());
    };
    ws.onclose = function () {
      done();
    };
    ws.onmessage = function (e) {
      if (typeof e.data === "string") {
        const msg = JSON.parse(e.data);
        if (msg.nodefony) {
          expect(msg.nodefony).to.equal("nodefony-core", "Message should be nodefony-core");
          expect(msg.name).to.equal("KERNEL", "Message should be KERNEL");
          expect(msg.foo).to.equal("bar", "Message should be bar");
          expect(msg.bar).to.equal("foo", "Message should be foo");
        } else {
          expect(parseInt(msg, 10)).to.be.a("number");
          ws?.close();
        }
      }
    };
  });
});
