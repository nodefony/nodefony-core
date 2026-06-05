import { expect, assert } from "chai";
import WebSocket from "ws";

const WSS = "wss://localhost:5152";
const wsOpts = { rejectUnauthorized: false };

describe("WEBSOCKETS UNIT TESTS ", () => {
  let ws: WebSocket | null = null;

  afterEach(() => {
    if (ws && ws.readyState !== WebSocket.CLOSED) {
      ws.terminate();
    }
    ws = null;
  });

  it("Instance WebSocket client 404", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      ws = new WebSocket(`${WSS}/nodefony/test/wsu`, wsOpts);
      ws.on("unexpected-response", (_req, res) => {
        expect(res.statusCode).to.equal(404);
        done();
      });
      ws.on("error", (error) => {
        done(error);
      });
      // ws accepts the upgrade then closes with an error code when route is not found
      ws.on("close", (code) => {
        expect(code).to.be.oneOf([1011, 4004]);
        done();
      });
    }));

  it("Instance WebSocket client", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      ws = new WebSocket(`${WSS}/nodefony/test/ws?foo=bar&bar=foo`, wsOpts);
      ws.on("open", () => {
        assert.isTrue(
          ws?.readyState === WebSocket.OPEN,
          "Connection should be established",
        );
        const number = Math.round(Math.random() * 0xffffff);
        ws?.send(number.toString());
      });
      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.error) {
            ws?.close();
            throw new Error(msg.error);
          }
          ws?.close();
        } catch (e) {
          ws?.close();
          throw e;
        }
      });
      ws.on("close", () => done());
      ws.on("error", (error) => done(error));
    }));

  it("Instance WebSocket echo", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      ws = new WebSocket(`${WSS}/nodefony/test/ws/echo`, wsOpts);
      ws.on("message", (data) => {
        const text = data.toString();
        assert.isString(text, "Message should be a string");
        const msg = JSON.parse(text);
        if (msg.handshake === true) {
          expect(text).to.equal(
            `{"handshake":true}`,
            "Message should be {'handshake':true}",
          );
          ws?.send(`{"handshake":"ok"}`);
        } else {
          expect(msg.handshake).to.equal(
            "ok",
            "Message should be {'handshake':'ok'}",
          );
          if (msg.handshake === "ok") {
            ws?.close();
          }
        }
      });
      ws.on("close", () => done());
      ws.on("error", (error) => done(error));
    }));

  it("Instance WebSocket echo-protocol", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      ws = new WebSocket(
        `${WSS}/nodefony/test/ws/echo/proto`,
        "echo-protocol",
        wsOpts,
      );
      ws.on("open", () => {
        assert.isTrue(
          ws?.readyState === WebSocket.OPEN,
          "Connection should be established",
        );
        ws?.send(`{"echo":"echo"}`);
      });
      ws.on("message", (data) => {
        const text = data.toString();
        assert.isString(text, "Message should be a string");
        const msg = JSON.parse(text);
        if (msg.nodefony?.websocket.state !== "connected") {
          expect(msg.echo).to.equal("echo", "Message should be 'echo'");
          ws?.close();
        } else {
          expect(msg.nodefony?.websocket.state).to.equal(
            "connected",
            "Message should be 'connected'",
          );
          expect(msg.nodefony?.websocket.protocol).to.equal(
            "echo-protocol",
            "Message should be 'echo-protocol'",
          );
        }
      });
      ws.on("close", () => done());
      ws.on("error", (error) => done(error));
    }));
});

describe("WEBSOCKETS ROUTER ", () => {
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

  it("Routage variables", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      doneCallback = done;
      createWs("wss://localhost:5152/nodefony/test/ws/routes/foo");
      ws!.on("message", () => {
        expect(msg.nodefony?.route.variablesMap["ele"]).to.equal(
          "foo",
          "Message should be 'foo'",
        );
        expect(msg.variables).to.equal("foo", "Message should be 'foo'");
        ws!.close();
      });
    }));

  it("Routage variables 2", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      doneCallback = done;
      createWs("wss://localhost:5152/nodefony/test/ws/routes/bar/route2/foo");
      ws!.on("message", () => {
        if (msg.variables) {
          expect(msg.nodefony?.route.variablesMap["var1"]).to.equal(
            "bar",
            "Message should be 'bar'",
          );
          expect(msg.nodefony?.route.variablesMap["var2"]).to.equal(
            "foo",
            "Message should be 'foo'",
          );
          expect(msg.variables.var1).to.equal("bar", "Message should be 'bar'");
          expect(msg.variables.var2).to.equal("foo", "Message should be 'bar'");
          ws!.send("echo");
        } else {
          if (msg.result === "echo") ws!.close();
        }
      });
    }));
});

// Test DURCI — régression du bleed inter-requêtes.
// `variablesMap` vivait sur l'instance `Route` partagée (statique, 1/route dans
// tout le process). `match()` y écrivait les params de CHAQUE requête → 2+
// connexions concurrentes sur la même route paramétrée s'écrasaient mutuellement
// les variables. Les tests "Routage variables" ci-dessus sont SÉQUENTIELS → ils
// ne pouvaient pas attraper la course. Ici N connexions ouvertes ~simultanément,
// valeurs toutes distinctes : chacune DOIT relire SA valeur. Avec le fix
// (snapshot per-requête via `Resolver.getMatchedParams()`) → déterministe vert ;
// sans le fix → quasi-certainement rouge (≥1 bleed).
describe("WEBSOCKETS ROUTER — isolation per-requête (test durci)", () => {
  const sockets = new Set<WebSocket>();

  afterEach(() => {
    for (const s of sockets) {
      if (s.readyState !== WebSocket.CLOSED) s.terminate();
    }
    sockets.clear();
  });

  it("N connexions concurrentes sur la même route ne se bleedent pas les variables", () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown): void => {
        if (err) reject(err);
        else resolve();
      };
      const N = 16;
      const expected = Array.from({ length: N }, (_, i) => `concval${i}`);
      const results: Array<{ exp: string; got: unknown }> = [];
      let settled = false;
      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        done(err);
      };

      for (const val of expected) {
        const ws = new WebSocket(
          `wss://localhost:5152/nodefony/test/ws/routes/${val}`,
          wsOpts,
        );
        sockets.add(ws);
        let captured = false;
        ws.on("message", (data) => {
          if (captured) return;
          let msg: any;
          try {
            msg = JSON.parse(data.toString());
          } catch {
            return;
          }
          // Ignorer le frame handshake "connected" sans variables matchées.
          const got = msg?.nodefony?.route?.variablesMap?.ele;
          if (got === undefined) return;
          captured = true;
          results.push({ exp: val, got });
          if (results.length === N) {
            const bleed = results.filter((r) => r.got !== r.exp);
            if (bleed.length) {
              finish(
                new Error(
                  `bleed inter-connexions (${bleed.length}/${N}) : ${bleed
                    .map((b) => `attendu '${b.exp}', reçu '${b.got}'`)
                    .join(" | ")}`,
                ),
              );
            } else {
              finish();
            }
          }
        });
        ws.on("error", (e) => finish(e as Error));
      }
    }));
});
