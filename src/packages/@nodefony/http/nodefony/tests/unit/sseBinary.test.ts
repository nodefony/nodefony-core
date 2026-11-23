/// <reference types="node" />
import http from "node:http";
import net from "node:net";
import { expect } from "vitest";
import { SseStream } from "../../src/context/http/SseStream";
import { StreamLifecycle } from "../../src/context/http/StreamLifecycle";
import type HttpContext from "../../src/context/http/HttpContext";

const open = () => {
  const response = new http.ServerResponse(
    new http.IncomingMessage(new net.Socket()),
  );
  const lifecycle = new StreamLifecycle({} as HttpContext, response, response, {
    stallTimeout: false,
    maxDuration: false,
    revalidate: null,
    identifier: null,
    foreignWriter: false,
    endsAtShutdown: false,
  });
  const sse = new SseStream(lifecycle, {
    heartbeat: false,
    maxEventBytes: 64 * 1024,
  });
  return { sse, response };
};

/**
 * ADR-0021 S8 bis — un flux SSE est du texte UTF-8 (WHATWG HTML §9.2) : des
 * octets n'y ont pas de forme. `JSON.stringify` les rendrait en objet
 * (`[1,2,255]` → `{"0":1,"1":2,"2":255}`) sans erreur ; on les refuse, et
 * c'est au producteur de les encoder dans sa charge, avec leur type.
 */
describe("SseStream.send — des octets sont refusés, pas déformés", () => {
  const bytes: [string, unknown][] = [
    ["Uint8Array", new Uint8Array([1, 2, 255])],
    ["Buffer", Buffer.from([1, 2, 255])],
    ["ArrayBuffer", new Uint8Array([1, 2, 255]).buffer],
    ["DataView", new DataView(new ArrayBuffer(3))],
  ];
  for (const [name, data] of bytes) {
    it(`${name} lève un TypeError et n'écrit rien`, () => {
      const { sse, response } = open();
      expect(() => sse.send(data)).to.throw(TypeError, /base64/);
      expect(response.writableLength).to.equal(0);
    });
  }

  it("un texte et un objet JSON partent toujours", () => {
    const { sse, response } = open();
    void sse.send("bonjour");
    void sse.send({ text: "bonjour" });
    expect(response.writableLength).to.be.greaterThan(0);
  });
});

/**
 * Une écriture rend TOUJOURS une promesse — jamais `undefined` : un envoi
 * « tire et oublie » s'écrit `void sse.send(d)`, sans `?.catch`. Retour d'une
 * application réelle (TS2532 à chaque appel). La promesse d'une écriture
 * acceptée est PARTAGÉE : aucune allocation par événement.
 */
describe("SseStream — une écriture rend toujours une promesse", () => {
  it("écriture acceptée : la même promesse résolue, partagée", async () => {
    const { sse } = open();
    const first = sse.send("un");
    const second = sse.comment("deux");
    const third = sse.retry(1000);
    expect(first).to.be.instanceOf(Promise);
    expect(second).to.equal(first);
    expect(third).to.equal(first);
    await expect(first).resolves.toBeUndefined();
  });

  it("flux fermé (client parti) : encore une promesse, résolue, rien d'écrit", async () => {
    const { sse, response } = open();
    response.emit("close");
    expect(sse.closed).to.equal(true);
    const before = response.writableLength;
    const late = sse.send("trop tard");
    expect(late).to.be.instanceOf(Promise);
    await expect(late).resolves.toBeUndefined();
    expect(response.writableLength).to.equal(before);
    expect(sse.close()).to.be.instanceOf(Promise);
  });
});
