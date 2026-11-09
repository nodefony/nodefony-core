/// <reference types="node" />
import { describe, it, expect, vi } from "vitest";
import WebsocketContext from "../../src/context/websocket/WebsocketContext.js";
import WebsocketResponse from "../../src/context/websocket/Response.js";

/**
 * Une connexion WebSocket qui se tait ne retient aucune trame.
 *
 * `handleMessage` rangeait la trame reçue dans `response.body`, où elle vivait
 * jusqu'à la trame suivante — avec le tampon de lecture dont elle est une vue :
 * 64 Ko d'externe mesurés par connexion inactive après une trame de 60 Ko. Et un
 * corps rendu (`setBody` → `send()`) restait accroché après son envoi.
 */
function makeWs() {
  const context: WebsocketContext = Object.create(WebsocketContext.prototype);
  const response = new WebsocketResponse(null, context);
  const sent = vi.fn((_payload: unknown) => Promise.resolve(response));
  const broadcasted = vi.fn((_payload: unknown) => undefined);
  Object.assign(response, { send: sent, broadcast: broadcasted });
  Object.assign(context, {
    server: { options: {} },
    connection: { close: vi.fn() },
    frameRate: null,
    rejected: false,
    response,
    resolver: {
      resolve: true,
      route: {},
      match: () => undefined,
      callController: () => undefined,
    },
    fireAsync: vi.fn(() => Promise.resolve([])),
    fire: vi.fn(),
    setMetaData: vi.fn(),
    logMessageContent: vi.fn(),
    reject: vi.fn(),
  });
  return { context, response, sent, broadcasted };
}

describe("WebsocketContext — aucune trame retenue par une connexion inactive", () => {
  it("la trame reçue n'est pas rangée dans response.body", async () => {
    const { context, response } = makeWs();
    await context.handleMessage(Buffer.alloc(60_000, 0x78), false);
    expect(response.body).toBe(null);
  });

  it("send() sans argument envoie le corps rendu PUIS le retire", async () => {
    const { context, response, sent } = makeWs();
    response.setBody('{"ok":true}');
    await context.send();
    expect(String(sent.mock.calls[0]?.[0])).toBe('{"ok":true}');
    expect(response.body).toBe(null);
  });

  it("broadcast() sans argument diffuse le corps rendu PUIS le retire", () => {
    const { context, response, broadcasted } = makeWs();
    response.setBody("tous");
    context.broadcast();
    expect(String(broadcasted.mock.calls[0]?.[0])).toBe("tous");
    expect(response.body).toBe(null);
  });

  it("un argument explicite laisse un corps rendu en place", async () => {
    const { context, response, sent } = makeWs();
    response.setBody("rendu");
    await context.send("explicite");
    expect(sent.mock.calls[0]?.[0]).toBe("explicite");
    expect(String(response.body)).toBe("rendu");
  });
});
