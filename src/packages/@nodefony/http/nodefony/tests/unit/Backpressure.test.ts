/// <reference types="node" />
/**
 * P2.8 — Backpressure du streaming HTTP (`HttpResponse.send`).
 *
 * Valide le contrat Node `stream.Writable.write()` : si `write()` retourne
 * `false` (buffer > highWaterMark), la Promise NE résout PAS avant l'event
 * `'drain'` (le producteur est freiné → RAM bornée). Si `true`, resolve immédiat.
 * Vérifie aussi le cleanup du listener `'drain'` (règle perf : pas de listener
 * qui fuit). Test en isolation via `HttpResponse.prototype.send.call(stub)` +
 * un mock minimal de `ServerResponse` (pas de serveur).
 */
import { expect } from "chai";
import { EventEmitter } from "node:events";
import HttpResponse from "../../src/context/http/Response";

// Mock minimal de http.ServerResponse : `write` au retour configurable + callback
// asynchrone (comme Node : `cb` appelé au nextTick, APRÈS le retour de write).
class MockServerResponse extends EventEmitter {
  written: unknown[] = [];
  private _ret: boolean;
  private _err: Error | null;
  constructor(ret: boolean, err: Error | null = null) {
    super();
    this._ret = ret;
    this._err = err;
  }
  write(
    chunk: unknown,
    _enc?: unknown,
    cb?: (e?: Error | null) => void,
  ): boolean {
    this.written.push(chunk);
    if (cb) process.nextTick(() => cb(this._err));
    return this._ret;
  }
}

function makeStub(res: MockServerResponse): HttpResponse {
  const logs: unknown[] = [];
  const stub = {
    context: { isRedirect: false },
    body: Buffer.from("payload"),
    encoding: "utf-8" as BufferEncoding,
    setBody() {},
    log: (e: unknown) => logs.push(e),
    response: res,
    _logs: logs,
  };
  return stub as unknown as HttpResponse;
}

function send(stub: HttpResponse): Promise<HttpResponse> {
  // flush=true → branche streaming
  return (
    HttpResponse.prototype.send as (
      c?: unknown,
      e?: BufferEncoding,
      f?: boolean,
    ) => Promise<HttpResponse>
  ).call(stub, undefined, "utf-8", true);
}

const settle = () => new Promise((r) => setImmediate(r));

describe("P2.8 — HttpResponse.send backpressure", () => {
  it("write()===true → resolve immédiat, aucun listener 'drain'", async () => {
    const res = new MockServerResponse(true);
    const stub = makeStub(res);
    await send(stub);
    expect(res.written).to.have.lengthOf(1);
    expect(res.listenerCount("drain")).to.equal(0);
  });

  it("write()===false → NE résout PAS avant 'drain', puis résout après", async () => {
    const res = new MockServerResponse(false);
    const stub = makeStub(res);
    let resolved = false;
    const p = send(stub).then((v) => {
      resolved = true;
      return v;
    });
    await settle(); // laisse passer microtasks + nextTick du callback
    expect(resolved, "ne doit pas résoudre tant que pas de drain").to.equal(
      false,
    );
    expect(res.listenerCount("drain")).to.equal(1);
    res.emit("drain");
    await p;
    expect(resolved).to.equal(true);
    // 'drain' est `once` → auto-détaché au fire (0 listener résiduel)
    expect(res.listenerCount("drain")).to.equal(0);
  });

  it("erreur d'écriture → résout (best-effort) + listener 'drain' nettoyé", async () => {
    const res = new MockServerResponse(false, new Error("socket write EPIPE"));
    const stub = makeStub(res);
    await send(stub);
    // le callback d'erreur retire le listener avant de résoudre
    expect(res.listenerCount("drain")).to.equal(0);
  });

  it("résolution unique (idempotente) même si 'drain' fire après resolve", async () => {
    const res = new MockServerResponse(false);
    const stub = makeStub(res);
    const p = send(stub);
    res.emit("drain");
    await p;
    // un second 'drain' ne doit pas relancer / casser
    expect(() => res.emit("drain")).to.not.throw();
    expect(res.listenerCount("drain")).to.equal(0);
  });
});
