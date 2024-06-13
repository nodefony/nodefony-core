import { expect, assert } from "chai";
import https from "node:https";
import "mocha";
import pkg from "websocket";
const { client } = pkg;

describe("WEBSOCKETS UNIT TESTS ", () => {
  let socket: pkg.client | null = null;
  beforeEach(() => {
    if (socket) {
      socket.abort();
      socket = null;
    }

    const agent = new https.Agent({ rejectUnauthorized: false });
    const config: pkg.IClientConfig = {
      webSocketVersion: 13,
      tlsOptions: { agent },
    };

    socket = new client(config);
    // socket.on("connectFailed", (errorDescription) => {
    //   console.log(errorDescription);
    // });
    return socket;
  });

  it("Instance WebSocket client 404", (done) => {
    socket?.connect("wss://localhost:5152/nodefony/test/wsu");
    socket?.on("connectFailed", (error) => {
      expect(error).to.be.an("error");
      expect(error.message).to.include("404");
      return done();
    });
  });

  it("Instance WebSocket client", (done) => {
    socket?.connect("wss://localhost:5152/nodefony/test/ws?foo=bar&bar=foo");
    let number: number;
    socket?.on("connect", (connection) => {
      assert.isTrue(connection.connected, "Connection should be established");
      connection.on("error", (error) => {
        console.log("Connection Error: " + error.toString());
        done(error);
      });
      connection.on("close", () => {
        done();
      });
      connection.on("message", (message: pkg.Message) => {
        if (message.type === "utf8") {
          try {
            assert.isString(message.utf8Data, "Message should be a string");
            const msg = JSON.parse((message as pkg.IUtf8Message).utf8Data);
            if (msg.error) {
              connection.close();
              throw msg.error;
            }
            connection.close();
          } catch (e) {
            console.error(e);
            connection.close();
            throw e;
          }
        }
      });
      const sendNumber = () => {
        if (connection.connected) {
          number = Math.round(Math.random() * 0xffffff);
          connection.sendUTF(number.toString());
        }
      };
      sendNumber();
    });
    socket?.on("connectFailed", (error) => {
      done(error);
    });
  });

  it("Instance WebSocket echo", (done) => {
    socket?.connect("wss://localhost:5152/nodefony/test/ws/echo");
    socket?.on("connect", (connection) => {
      connection.on("message", (message: pkg.Message) => {
        assert.isString(
          (message as pkg.IUtf8Message).utf8Data,
          "Message should be a string"
        );
        const msg = JSON.parse((message as pkg.IUtf8Message).utf8Data);
        if (msg.handshake === true) {
          expect((message as pkg.IUtf8Message).utf8Data).to.equal(
            `{"handshake":true}`,
            "Message should be {'handshake':true}"
          );
          connection.sendUTF(`{"handshake":"ok"}`);
        } else {
          expect(msg.handshake).to.equal(
            `ok`,
            "Message should be {'handshake':'ok'}"
          );
          if (msg.handshake === "ok") {
            connection.close();
          }
        }
      });
      connection.on("close", () => {
        done();
      });
    });
    socket?.on("connectFailed", (error) => {
      done(error);
    });
  });

  it("Instance WebSocket echo-protocol", (done) => {
    //return done();
    socket?.connect(
      "wss://localhost:5152/nodefony/test/ws/echo/proto",
      "echo-protocol"
    );
    socket?.on("connect", (connection) => {
      assert.isTrue(connection.connected, "Connection should be established");
      connection.on("error", (error) => {
        console.log("Connection Error: " + error.toString());
        done(error);
      });
      connection.on("close", () => {
        done();
      });
      connection.on("message", (message: pkg.Message) => {
        if (message && message.type === "utf8") {
          assert.isString(message.utf8Data, "Message should be a string");
          const msg = JSON.parse((message as pkg.IUtf8Message).utf8Data);
          if (msg.nodefony?.websocket.state !== "connected") {
            expect(msg.echo).to.equal("echo", "Message should be 'echo'");
            connection.close();
          } else {
            expect(msg.nodefony?.websocket.state).to.equal(
              "connected",
              "Message should be 'connected'"
            );
            expect(msg.nodefony?.websocket.protocol).to.equal(
              "echo-protocol",
              "Message should be 'echo-protocol'"
            );
          }
        }
      });
      connection.sendUTF(`{"echo":"echo"}`);
    });
    socket?.on("connectFailed", (error) => {
      done(error);
    });
  });
});

describe("WEBSOCKETS ROUTER ", () => {
  let socket: pkg.client | null = null;
  let connection: pkg.connection | null;
  let doneCallback: ((err?: any) => void) | null = null;
  let msg: any;
  let isDone = false;

  beforeEach(async () => {
    const agent = new https.Agent({ rejectUnauthorized: false });
    const config: pkg.IClientConfig = {
      webSocketVersion: 13,
      tlsOptions: { agent },
    };
    socket = new client(config);
    if (socket) {
      socket.on("connectFailed", (errorDescription) => {
        console.log(errorDescription);
        if (doneCallback && !isDone) {
          isDone = true;
          doneCallback(errorDescription);
        }
      });
      socket?.on("connect", (myconnection) => {
        connection = myconnection;
        assert.isTrue(connection.connected, "Connection should be established");
        connection.on("error", (error) => {
          console.log("Connection Error: " + error.toString());
          if (doneCallback && !isDone) {
            isDone = true;
            doneCallback(error);
          }
        });
        connection.on("message", (message: pkg.Message) => {
          msg = JSON.parse((message as pkg.IUtf8Message).utf8Data);
        });
        connection.on("close", () => {
          if (doneCallback && !isDone) {
            isDone = true;
            doneCallback();
          }
        });
      });
      return socket;
    }
  });

  afterEach(async () => {
    if (connection && (connection as pkg.connection).connected) {
      (connection as pkg.connection).close();
    }
    if (socket) {
      socket.abort();
      socket = null;
    }
    if (doneCallback) {
      doneCallback = null;
      isDone = false;
    }
    msg = null;
  });

  it("Routage variables", (done) => {
    doneCallback = done;
    socket?.connect("wss://localhost:5152/nodefony/test/ws/routes/foo");
    socket?.on("connect", (connection) => {
      connection.on("message", (message: pkg.Message) => {
        expect(msg.nodefony?.route.variablesMap["ele"]).to.equal(
          "foo",
          "Message should be 'foo'"
        );
        expect(msg.variables).to.equal("foo", "Message should be 'foo'");
        connection.close();
      });
    });
  });

  it("Routage variables 2", (done) => {
    doneCallback = done;
    socket?.connect(
      "wss://localhost:5152/nodefony/test/ws/routes/bar/route2/foo"
    );
    socket?.on("connect", (connection) => {
      connection.on("message", (message: pkg.Message) => {
        if (msg.variables) {
          expect(msg.nodefony?.route.variablesMap["var1"]).to.equal(
            "bar",
            "Message should be 'bar'"
          );
          expect(msg.nodefony?.route.variablesMap["var2"]).to.equal(
            "foo",
            "Message should be 'foo'"
          );
          expect(msg.variables.var1).to.equal("bar", "Message should be 'bar'");
          expect(msg.variables.var2).to.equal("foo", "Message should be 'bar'");
          connection.sendUTF("echo");
        } else {
          if (msg.result === "echo") connection.close();
        }
      });
    });
  });
});
