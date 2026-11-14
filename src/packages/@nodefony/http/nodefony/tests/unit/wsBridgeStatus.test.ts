/// <reference types="node" />
import { describe, it, expect } from "vitest";
import { RequestContext } from "nodefony";
import type { RequestContextPayload } from "nodefony";
import WebsocketResponse from "../../src/context/websocket/Response";
import type WebsocketContext from "../../src/context/websocket/WebsocketContext";

/**
 * Ce que ce test prouve : un statut posé par une action invoquée par le pont
 * `api.request` (`renderJson(corps, 404)`) appartient à CETTE invocation, pas à
 * la connexion.
 *
 * La réponse WebSocket est celle de la CONNEXION entière, et son `statusCode`
 * est le code de FERMETURE qu'un `close()` sans argument enverra. Écrire 404
 * dedans perdait le statut pour le pont (servi en succès : le client recevait
 * `{ error: "job introuvable" }` comme un job) ET empoisonnait la fermeture de
 * la socket avec un code hors de la plage RFC 6455.
 */
function makeResponse(): WebsocketResponse {
  return new WebsocketResponse(null, {} as unknown as WebsocketContext);
}

function bridgePayload(sink: object) {
  return {
    requestId: "t",
    renderSink: sink,
  } as unknown as RequestContextPayload;
}

describe("WebsocketResponse.setStatusCode — statut d'une invocation du pont", () => {
  it("sous le pont, le statut va au sink et la connexion garde son code de fermeture", () => {
    const response = makeResponse();
    const sink: { body?: string | Buffer; status?: number } = {};
    RequestContext.run(bridgePayload(sink), () => {
      response.setStatusCode(404);
    });
    expect(sink.status).toBe(404);
    expect(response.statusCode).toBe(1000);
  });

  it("un statut textuel est normalisé comme sur la connexion", () => {
    const response = makeResponse();
    const sink: { body?: string | Buffer; status?: number } = {};
    RequestContext.run(bridgePayload(sink), () => {
      response.setStatusCode("403");
    });
    expect(sink.status).toBe(403);
  });

  it("hors pont, le statut reste celui de la connexion (code de fermeture)", () => {
    const response = makeResponse();
    response.setStatusCode(1008);
    expect(response.statusCode).toBe(1008);
  });
});

describe("WebsocketResponse.setHeader — `Retry-After` d'une invocation du pont", () => {
  it("sous le pont, `Retry-After` va au puits de l'invocation, quelle que soit sa casse", () => {
    const response = makeResponse();
    const sink: { retryAfter?: string } = {};
    RequestContext.run(bridgePayload(sink), () => {
      response.setHeader("retry-after", 7);
    });
    expect(sink.retryAfter).toBe("7");
    expect(response.handshakeHeaders).toBeNull();
  });

  it("🔴 aucun autre en-tête ne passe par le puits : rien ne fuit sur une trame", () => {
    const response = makeResponse();
    const sink: Record<string, unknown> = {};
    RequestContext.run(bridgePayload(sink), () => {
      response.setHeader("Set-Cookie", "sid=secret");
      response.setHeader("WWW-Authenticate", "Basic");
    });
    expect(sink).toEqual({});
    expect(response.handshakeHeaders).toBeNull();
  });

  it("hors pont, l'en-tête reste celui du handshake", () => {
    const response = makeResponse();
    response.setHeader("Retry-After", "3");
    expect(response.handshakeHeaders).toEqual({ "Retry-After": "3" });
  });
});
