/// <reference types="node" />
/**
 * Vocabulaire du transport d'une requête (#639) : la famille (`type`) se lit
 * sur l'identité du serveur, le protocole du saut (`alpnProtocol`) se CONSTATE
 * sur la requête. Le câblage sur de vrais serveurs est prouvé en intégration
 * (`http/http1.test.ts`, `http/https.test.ts`).
 */
import { expect } from "vitest";
import {
  alpnProtocolOf,
  protocolNameOf,
  type IAlpnSource,
} from "../../src/context/transport.js";
import type { ServerType } from "../../interfaces/IContext.js";

/** Requête Node minimale : version HTTP et, pour h2, l'ALPN de la session. */
function request(major: 1 | 2, sessionAlpn?: string): IAlpnSource {
  return major === 2
    ? {
        httpVersionMajor: 2,
        stream: { session: { alpnProtocol: sessionAlpn } },
      }
    : { httpVersionMajor: 1 };
}

describe("transport — matrice type · alpnProtocol", () => {
  const matrix: ReadonlyArray<{
    cas: string;
    serverType: ServerType;
    req?: IAlpnSource;
    type: string;
    alpn?: string;
  }> = [
    {
      cas: "HTTP/1.1 en clair",
      serverType: "http",
      req: request(1),
      type: "http",
      alpn: "http/1.1",
    },
    {
      cas: "HTTP/1.1 sur TLS",
      serverType: "https",
      req: request(1),
      type: "http",
      alpn: "http/1.1",
    },
    {
      cas: "h2 sur TLS",
      serverType: "https",
      req: request(2, "h2"),
      type: "http",
      alpn: "h2",
    },
    {
      cas: "h2c (HTTP/2 en clair)",
      serverType: "http",
      req: request(2, "h2c"),
      type: "http",
      alpn: "h2c",
    },
    { cas: "WebSocket", serverType: "ws", type: "websocket" },
    { cas: "WebSocket sur TLS", serverType: "wss", type: "websocket" },
  ];

  for (const row of matrix) {
    it(`${row.cas} → type ${row.type}${row.alpn ? ` · ${row.alpn}` : ""}`, () => {
      expect(protocolNameOf(row.serverType)).to.equal(row.type);
      if (row.req) expect(alpnProtocolOf(row.req)).to.equal(row.alpn);
    });
  }

  it("h2 dont la session a déjà disparu → repli h2 (jamais http/1.1)", () => {
    const req: IAlpnSource = {
      httpVersionMajor: 2,
      stream: { session: undefined },
    };
    expect(alpnProtocolOf(req)).to.equal("h2");
  });

  it("le chiffrement ne vient PAS du serveur : h2c sur un serveur `https` reste h2c", () => {
    expect(alpnProtocolOf(request(2, "h2c"))).to.equal("h2c");
  });
});
