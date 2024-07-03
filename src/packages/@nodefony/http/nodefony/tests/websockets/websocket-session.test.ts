import { assert } from "chai";
import https from "node:https";
import "mocha";
import pkg from "websocket";
const { client } = pkg;

describe("WEBSOCKETS SESSION ", () => {
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
        //console.log(errorDescription);
        if (doneCallback && !isDone) {
          isDone = true;
          doneCallback(errorDescription);
        }
      });
      socket?.on("connect", (myconnection) => {
        connection = myconnection;
        assert.isTrue(connection.connected, "Connection should be established");
        connection.on("error", (error) => {
          //console.log("Connection Error: " + error.toString());
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

  it("Cookie ", (done) => {
    doneCallback = done;
    socket?.connect("wss://localhost:5152/nodefony/test/ws/cookie");
    socket?.on("connect", (connection) => {
      connection.on("message", (/*message: pkg.Message*/) => {
        connection.close();
      });
    });
  });
});
