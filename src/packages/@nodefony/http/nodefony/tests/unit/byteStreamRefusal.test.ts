/// <reference types="node" />
import http from "node:http";
import net from "node:net";
import { Readable } from "node:stream";
import { expect } from "vitest";
import { openByteStream } from "../../src/context/http/ByteStream";
import type HttpContext from "../../src/context/http/HttpContext";

/**
 * Une ouverture REFUSÉE détruit la source qu'on lui a confiée (#724).
 *
 * La source appartient au flux dès l'appel : si l'ouverture lève (réponse déjà
 * prise, plafond par IP atteint, option hors bornes, source en mode objet),
 * personne d'autre ne l'arrêtera — un relais `fetch` garderait sa connexion
 * amont ouverte, un producteur enfant resterait bloqué en écriture.
 */

/** Contexte réduit à ce que l'ouverture lit avant de refuser. */
function contextOf(state: { sended?: boolean; slot?: boolean }): HttpContext {
  const req = new http.IncomingMessage(new net.Socket());
  const res = new http.ServerResponse(req);
  const fake = {
    sended: state.sended ?? false,
    finished: false,
    session: null,
    request: { request: req },
    response: {
      response: res,
      timeout: 30_000,
      isHeaderSent: () => false,
    },
    httpKernel: {
      acquireConnectionSlot: () => state.slot ?? true,
      firewall: null,
    },
    log: () => undefined,
  };
  return fake as unknown as HttpContext;
}

/** Une source qui relève sa destruction. */
function trackedSource(): { source: Readable; destroyed: () => boolean } {
  let destroyed = false;
  const source = new Readable({
    read() {
      // Rien n'est jamais lu : l'ouverture est refusée.
    },
    destroy(error, callback) {
      destroyed = true;
      callback(error);
    },
  });
  return { source, destroyed: () => destroyed };
}

describe("Flux d'octets — une ouverture refusée détruit la source", () => {
  it("réponse déjà prise (500)", () => {
    const { source, destroyed } = trackedSource();
    expect(() => openByteStream(contextOf({ sended: true }), source)).to.throw(
      /déjà partie/,
    );
    expect(destroyed(), "source détruite").to.equal(true);
  });

  it("plafond par IP atteint (429)", () => {
    const { source, destroyed } = trackedSource();
    expect(() => openByteStream(contextOf({ slot: false }), source)).to.throw(
      /trop de connexions/,
    );
    expect(destroyed(), "source détruite").to.equal(true);
  });

  it("option hors bornes (RangeError)", () => {
    const { source, destroyed } = trackedSource();
    expect(() =>
      openByteStream(contextOf({}), source, { status: 42 }),
    ).to.throw(RangeError);
    expect(destroyed(), "source détruite").to.equal(true);
  });

  it("source en mode objet (TypeError)", () => {
    const source = Readable.from([{ a: 1 }]);
    expect(() => openByteStream(contextOf({}), source)).to.throw(TypeError);
    expect(source.destroyed, "source détruite").to.equal(true);
  });

  it("flux web refusé : il est ANNULÉ, ce qui ferme l'amont d'un fetch", async () => {
    let cancelled = false;
    const web = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    expect(() => openByteStream(contextOf({ sended: true }), web)).to.throw(
      /déjà partie/,
    );
    await new Promise((r) => setImmediate(r));
    expect(cancelled, "flux web annulé").to.equal(true);
  });
});
