/// <reference types="node" />
import http from "node:http";
import net from "node:net";
import { expect } from "vitest";
import { SseStream } from "../../src/context/http/SseStream";
import type HttpContext from "../../src/context/http/HttpContext";

/**
 * ADR-0021 S8 bis — un flux SSE est du texte UTF-8 (WHATWG HTML §9.2) : des
 * octets n'y ont pas de forme. `JSON.stringify` les rendrait en objet
 * (`[1,2,255]` → `{"0":1,"1":2,"2":255}`) sans erreur ; on les refuse, et
 * c'est au producteur de les encoder dans sa charge, avec leur type.
 */
describe("SseStream.send — des octets sont refusés, pas déformés", () => {
  const open = () => {
    const response = new http.ServerResponse(
      new http.IncomingMessage(new net.Socket()),
    );
    const sse = new SseStream({} as HttpContext, response, response, {
      heartbeat: false,
      stallTimeout: false,
      maxEventBytes: 64 * 1024,
      maxDuration: false,
      revalidate: null,
      identifier: null,
    });
    return { sse, response };
  };

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
