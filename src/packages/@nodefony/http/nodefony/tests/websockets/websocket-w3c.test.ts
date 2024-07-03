import { expect } from "chai";
import https from "node:https";
import "mocha";
import pkg from "websocket";
const { w3cwebsocket } = pkg;

describe("WEBSOCKETS W3C ", () => {
  let socket: pkg.w3cwebsocket;
  let agent: https.Agent | null = null;
  let config: pkg.IClientConfig | null;
  //let doneCallback: ((err?: any) => void) | null = null;
  //let msg: any;
  //let isDone = false;

  beforeEach(async () => {
    agent = new https.Agent({ rejectUnauthorized: false });
    config = {
      webSocketVersion: 13,
      tlsOptions: { agent },
    };
  });

  afterEach(async () => {});

  it("W3C websocket 404", (done) => {
    socket = new w3cwebsocket(
      "wss://localhost:5152/nodefony/test/wsu?foo=bar&bar=foo",
      undefined,
      undefined,
      undefined,
      undefined,
      config as pkg.IClientConfig
    );

    socket.onclose = function () {
      //console.log(event.code, event.reason);
      done();
    };
  });

  it("W3C websocket", (done) => {
    socket = new w3cwebsocket(
      "wss://localhost:5152/nodefony/test/ws?foo=bar&bar=foo",
      undefined,
      undefined,
      undefined,
      undefined,
      config as pkg.IClientConfig
    );
    socket.onerror = function () {
      console.log("Connection Error");
    };
    socket.onopen = function () {
      function sendNumber() {
        if (socket.readyState === socket.OPEN) {
          var number = Math.round(Math.random() * 0xffffff);
          socket.send(number.toString());
        }
      }
      sendNumber();
    };
    socket.onclose = function () {
      done();
    };
    socket.onmessage = function (e) {
      if (typeof e.data === "string") {
        let msg = JSON.parse(e.data);
        if (msg.nodefony) {
          expect(msg.nodefony).to.equal(
            `nodefony-core`,
            "Message should be nodefony-core"
          );
          expect(msg.name).to.equal(`KERNEL`, "Message should be KERNEL");
          expect(msg.foo).to.equal(`bar`, "Message should be bar");
          expect(msg.bar).to.equal(`foo`, "Message should be foo");
        } else {
          expect(parseInt(msg, 10)).to.be.a("number");
          socket.close();
        }
      }
    };
  });
});
