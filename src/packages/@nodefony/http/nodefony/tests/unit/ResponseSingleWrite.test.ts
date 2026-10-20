/// <reference types="node" />
/**
 * Une réponse UNIQUE part en UN SEUL appel — `end(corps)`, jamais `write` puis
 * `end()` vide.
 *
 * Ce que ce test garde, et pourquoi il ne se déduit pas du code : depuis Node
 * 26.8 (nodejs/node#65466), la finalisation est attachée à l'écriture quand le
 * corps est donné AU `end()`. `maybePrepareFinalChunk` accepte une chaîne ou un
 * `Uint8Array` — donc un `Buffer` —, et évite « a separate send() & tick step ».
 * En écrivant par `write(corps)` puis `end()` vide, on sortait de ce chemin et
 * l'on payait un tick de boucle d'événements par réponse.
 *
 * La contre-pression n'est pas perdue pour autant : elle n'a de sens que pour le
 * streaming chunké (`flush()`, RFC 9112 §7.1 — 1 écriture = 1 chunk), où le
 * producteur DOIT être freiné si le client est lent. Une réponse unique n'a rien
 * à écrire ensuite. Les deux branches sont donc vérifiées ICI, côte à côte :
 * séparées, on corrigerait l'une en cassant l'autre sans le voir.
 */
import { expect } from "vitest";
import { EventEmitter } from "node:events";
import HttpResponse from "../../src/context/http/Response";
import Http2Response from "../../src/context/http2/Response";

/** Mock minimal : compte les appels, distingue `end(corps)` de `end()` vide. */
class MockServerResponse extends EventEmitter {
  written: unknown[] = [];
  ended: unknown[] = [];
  writableEnded = false;
  write(chunk: unknown, _enc?: unknown, cb?: (e?: Error | null) => void) {
    this.written.push(chunk);
    if (cb) process.nextTick(() => cb(null));
    return true;
  }
  end(chunk?: unknown) {
    this.ended.push(chunk);
    this.writableEnded = true;
    return this;
  }
}

function makeStub(res: MockServerResponse, flushing = false): HttpResponse {
  // Instance RÉELLE : le corps vit dans des champs privés, qu'un objet littéral
  // appelé par `prototype.call` ne porte pas.
  const r = new HttpResponse(
    res as never,
    { isRedirect: false, httpKernel: null, type: "http" } as never,
  );
  r.setBody(Buffer.from("payload"));
  r.flushing = flushing;
  return r;
}

const send = (stub: HttpResponse, flush: boolean) =>
  HttpResponse.prototype.send.call(stub, undefined, "utf-8", flush);

describe("HttpResponse.send — une réponse unique part en un seul appel", () => {
  it("réponse unique : end(corps) UNE fois, write JAMAIS", async () => {
    const res = new MockServerResponse();
    await send(makeStub(res), false);
    expect(res.written, "aucune écriture séparée").to.have.lengthOf(0);
    expect(res.ended, "un seul end").to.have.lengthOf(1);
    expect(
      Buffer.isBuffer(res.ended[0]),
      "le corps doit être PASSÉ à end() — c'est la condition de nodejs#65466",
    ).to.equal(true);
    expect((res.ended[0] as Buffer).toString()).to.equal("payload");
  });

  it("streaming chunké (flush) : write, et surtout PAS de end ici", async () => {
    // La branche que le correctif ne doit pas toucher : c'est `close()` qui
    // termine un flux chunké, après le dernier chunk.
    const res = new MockServerResponse();
    await send(makeStub(res), true);
    expect(res.written, "le chunk part par write").to.have.lengthOf(1);
    expect(res.ended, "flush ne termine pas la réponse").to.have.lengthOf(0);
    expect(res.listenerCount("drain"), "aucun listener qui fuit").to.equal(0);
  });

  it("flushing déjà posé : reste sur write même sans le drapeau flush", async () => {
    // `Response.flush()` pose `flushing = true` puis appelle `send(..., true)`.
    // Un envoi ultérieur sans le drapeau ne doit pas basculer en `end(corps)` au
    // milieu d'un flux chunké — il le tronquerait.
    const res = new MockServerResponse();
    await send(makeStub(res, true), false);
    expect(res.written).to.have.lengthOf(1);
    expect(res.ended).to.have.lengthOf(0);
  });

  it("flux DÉJÀ terminé : ne réécrit rien, ne re-termine rien", async () => {
    const res = new MockServerResponse();
    res.writableEnded = true;
    await send(makeStub(res), false);
    expect(res.ended, "pas de second end sur un flux clos").to.have.lengthOf(0);
  });
});

/**
 * Le même contrat sur HTTP/2 (5152, h2c) : le corps part par `stream.end(corps)`.
 * `write` puis `end()` vide y coûtait davantage qu'en HTTP/1 — l'attente du
 * rappel d'écriture (un tour de boucle) ET une trame DATA vide de plus, juste
 * pour porter END_STREAM.
 */
class MockHttp2Stream extends EventEmitter {
  id = 1;
  pushAllowed = false;
  destroyed = false;
  closed = false;
  headersSent = true;
  writable = true;
  writableEnded = false;
  written: unknown[] = [];
  ended: unknown[] = [];
  write(chunk: unknown, _enc?: unknown, cb?: (e?: Error | null) => void) {
    this.written.push(chunk);
    if (cb) process.nextTick(() => cb(null));
    return true;
  }
  end(chunk?: unknown) {
    this.ended.push(chunk);
    this.writable = false;
    this.writableEnded = true;
    return this;
  }
}

function makeHttp2Stub(stream: MockHttp2Stream, flushing = false) {
  const r = new Http2Response(
    { stream } as never,
    { isRedirect: false, httpKernel: null, type: "http" } as never,
  );
  r.setBody(Buffer.from("payload"));
  r.flushing = flushing;
  return r;
}

describe("Http2Response.send — une réponse unique part en un seul appel", () => {
  it("réponse unique : stream.end(corps) UNE fois, SYNCHRONE, write JAMAIS", () => {
    const stream = new MockHttp2Stream();
    const result = makeHttp2Stub(stream).send(undefined, "utf-8", false);
    expect(result, "rien à attendre : pas de promesse").not.to.be.instanceOf(
      Promise,
    );
    expect(stream.written, "aucune écriture séparée").to.have.lengthOf(0);
    expect(stream.ended, "un seul end").to.have.lengthOf(1);
    expect((stream.ended[0] as Buffer).toString()).to.equal("payload");
  });

  it("end() après l'envoi : le flux terminé n'est pas re-terminé", () => {
    // `HttpContext.endResponse` lit `writableEnded` sur la réponse de
    // compatibilité, que l'écriture directe sur le flux ne pose pas : c'est
    // `end()` qui doit reconnaître le flux déjà terminé.
    const stream = new MockHttp2Stream();
    const stub = makeHttp2Stub(stream);
    // Synchrones ici (réponse unique, flux terminé) : rien à attendre.
    void stub.send(undefined, "utf-8", false);
    void stub.end();
    expect(stream.ended, "pas de trame DATA vide en plus").to.have.lengthOf(1);
  });

  it("streaming (flush) : write et son rappel, PAS de end ici", async () => {
    const stream = new MockHttp2Stream();
    await makeHttp2Stub(stream).send(undefined, "utf-8", true);
    expect(stream.written, "le morceau part par write").to.have.lengthOf(1);
    expect(stream.ended, "flush ne termine pas le flux").to.have.lengthOf(0);
  });

  it("flushing déjà posé : reste sur write même sans le drapeau flush", async () => {
    const stream = new MockHttp2Stream();
    await makeHttp2Stub(stream, true).send(undefined, "utf-8", false);
    expect(stream.written).to.have.lengthOf(1);
    expect(stream.ended).to.have.lengthOf(0);
  });
});
