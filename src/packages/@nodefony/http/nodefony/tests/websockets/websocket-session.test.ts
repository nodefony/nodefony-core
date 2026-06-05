import { assert } from "chai";
import WebSocket from "ws";

const wsOpts = { rejectUnauthorized: false };

describe("WEBSOCKETS SESSION ", () => {
  let ws: WebSocket | null = null;
  let doneCallback: ((err?: any) => void) | null = null;
  let msg: any;
  let isDone = false;

  function createWs(url: string): void {
    ws = new WebSocket(url, wsOpts);
    ws.on("error", (error) => {
      if (doneCallback && !isDone) {
        isDone = true;
        doneCallback(error);
      }
    });
    ws.on("message", (data) => {
      msg = JSON.parse(data.toString());
    });
    ws.on("close", () => {
      if (doneCallback && !isDone) {
        isDone = true;
        doneCallback();
      }
    });
  }

  afterEach(async () => {
    if (ws && ws.readyState !== WebSocket.CLOSED) {
      ws.terminate();
    }
    ws = null;
    doneCallback = null;
    isDone = false;
    msg = null;
  });

  it("Cookie ", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      doneCallback = done;
      createWs("wss://localhost:5152/nodefony/test/ws/cookie");
      ws!.on("message", () => {
        assert.exists(msg);
        ws!.close();
      });
    }));
});
