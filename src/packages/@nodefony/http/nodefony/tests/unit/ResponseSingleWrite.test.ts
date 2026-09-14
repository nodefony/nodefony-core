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
import { expect } from "chai";
import { EventEmitter } from "node:events";
import HttpResponse from "../../src/context/http/Response";

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
  return {
    context: { isRedirect: false },
    body: Buffer.from("payload"),
    encoding: "utf-8" as BufferEncoding,
    flushing,
    setBody() {},
    log() {},
    response: res,
  } as unknown as HttpResponse;
}

const send = (stub: HttpResponse, flush: boolean) =>
  (
    HttpResponse.prototype.send as (
      c?: unknown,
      e?: BufferEncoding,
      f?: boolean,
    ) => Promise<HttpResponse>
  ).call(stub, undefined, "utf-8", flush);

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
