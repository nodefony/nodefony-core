/// <reference types="node" />
import { expect } from "chai";
import http from "node:http";
import HttpRequest from "../../src/context/http/Request";
import Http2Request from "../../src/context/http2/Request";
import WebsocketContext from "../../src/context/websocket/WebsocketContext";
import type { ResolvedProxy } from "../../src/context/forwarded";

// Câblage des MÉTHODES finales qui consomment la résolution forwarded
// (this.forwarded). Isolées via Object.create : on bypass le constructeur lourd
// (kernel/sockets) pour ne tester QUE la dérivation scheme/IP ← forwarded.

const fwd = (p: Partial<ResolvedProxy>): ResolvedProxy => ({
  clientIp: null,
  fromStandard: true,
  ...p,
});

const stub = <T>(proto: object, props: object): T =>
  Object.assign(Object.create(proto), props) as unknown as T;

const fakeReq = (socket: object, url = "/p"): http.IncomingMessage =>
  ({ url, socket }) as unknown as http.IncomingMessage;

describe("HttpRequest.getFullUrl — scheme effectif ← forwarded", () => {
  // F-B : `getRawTarget()` lit `this.request` (source unique partagée avec la
  // découpe fast-path) → le stub porte la même requête que celle passée à
  // `getFullUrl` — comme le fait le ctor réel (`this.request = request`).
  // `getFullUrl` POSE aussi `this.scheme` (consommé par HttpContext.setScheme
  // sans construire l'URL) : asserté ici, c'est le câblage.
  it("forwarded.proto présent → scheme proxifié (https)", () => {
    const nodeReq = fakeReq({ encrypted: false });
    const req = stub<HttpRequest>(HttpRequest.prototype, {
      host: "example.com",
      forwarded: fwd({ proto: "https" }),
      request: nodeReq,
    });
    expect(req.getFullUrl(nodeReq)).to.equal("https://example.com/p");
    expect(req.scheme).to.equal("https");
  });

  it("sans forwarded → transport réel (socket.encrypted=true → https)", () => {
    const nodeReq = fakeReq({ encrypted: true });
    const req = stub<HttpRequest>(HttpRequest.prototype, {
      host: "example.com",
      forwarded: null,
      request: nodeReq,
    });
    expect(req.getFullUrl(nodeReq)).to.equal("https://example.com/p");
    expect(req.scheme).to.equal("https");
  });

  it("sans forwarded + socket clair → http", () => {
    const nodeReq = fakeReq({ encrypted: false });
    const req = stub<HttpRequest>(HttpRequest.prototype, {
      host: "example.com",
      forwarded: null,
      request: nodeReq,
    });
    expect(req.getFullUrl(nodeReq)).to.equal("http://example.com/p");
    expect(req.scheme).to.equal("http");
  });
});

describe("HttpRequest.getRemoteAddress — IP cliente ← forwarded", () => {
  it("forwarded.clientIp présent → IP réelle résolue (pas le socket)", () => {
    const req = stub<HttpRequest>(HttpRequest.prototype, {
      forwarded: fwd({ clientIp: "203.0.113.9" }),
      request: { socket: { remoteAddress: "127.0.0.1" } },
    });
    expect(req.getRemoteAddress()).to.equal("203.0.113.9");
  });

  it("sans forwarded → adresse du socket", () => {
    const req = stub<HttpRequest>(HttpRequest.prototype, {
      forwarded: null,
      request: { socket: { remoteAddress: "203.0.113.50" } },
    });
    expect(req.getRemoteAddress()).to.equal("203.0.113.50");
  });
});

describe("Http2Request.getFullUrl — scheme effectif ← forwarded", () => {
  it("forwarded.proto présent → scheme proxifié", () => {
    const req = stub<Http2Request>(Http2Request.prototype, {
      host: "example.com",
      forwarded: fwd({ proto: "https" }),
      headers: { ":path": "/p", ":scheme": "http" },
    });
    expect(req.getFullUrl()).to.equal("https://example.com/p");
  });

  it("sans forwarded → pseudo-header :scheme", () => {
    const req = stub<Http2Request>(Http2Request.prototype, {
      host: "example.com",
      forwarded: null,
      headers: { ":path": "/p", ":scheme": "https" },
    });
    expect(req.getFullUrl()).to.equal("https://example.com/p");
  });
});

describe("WebsocketContext.getRemoteAddress — IP cliente ← forwarded", () => {
  it("forwarded.clientIp présent → IP réelle (pas le socket)", () => {
    const ctx = stub<WebsocketContext>(WebsocketContext.prototype, {
      forwarded: fwd({ clientIp: "203.0.113.9" }),
      request: { socket: { remoteAddress: "127.0.0.1" } },
    });
    expect(ctx.getRemoteAddress()).to.equal("203.0.113.9");
  });

  it("sans forwarded → adresse du socket", () => {
    const ctx = stub<WebsocketContext>(WebsocketContext.prototype, {
      forwarded: null,
      request: { socket: { remoteAddress: "203.0.113.50" } },
    });
    expect(ctx.getRemoteAddress()).to.equal("203.0.113.50");
  });
});
