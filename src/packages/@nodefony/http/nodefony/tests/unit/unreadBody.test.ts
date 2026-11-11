/// <reference types="node" />
/**
 * Corps de requête NON LU au moment de répondre (#695, critère 51 ; ADR-0026,
 * D5) — HTTP/1.1. Node vide lui-même un corps non consommé pour réutiliser la
 * connexion, sans borne : `HttpResponse.closeUnfinishedRequest` ne le laisse
 * faire que pour un corps déclaré d'au plus 256 Kio, et ferme la connexion
 * au-delà ou quand la longueur est inconnue. La décision tombe AVANT les
 * en-têtes, sur la longueur annoncée — jamais en attendant le corps.
 */
import { describe, expect, it } from "vitest";
import type http from "node:http";
import { EventEmitter } from "node:events";
import type net from "node:net";
import HttpResponse, {
  UNREAD_BODY_DRAIN_LIMIT,
  UNREAD_BODY_LINGER_MS,
} from "../../src/context/http/Response.js";
import type HttpContext from "../../src/context/http/HttpContext.js";

function respond(
  headers: http.IncomingHttpHeaders,
  options: {
    complete?: boolean;
    headersSent?: boolean;
    socket?: net.Socket | null;
  } = {},
): HttpResponse {
  const native = {
    headersSent: options.headersSent ?? false,
    getHeader: () => undefined,
    socket: options.socket ?? null,
  } as unknown as http.ServerResponse;
  const ctx = {
    type: "http",
    log: () => undefined,
    request: { headers, request: { complete: options.complete ?? false } },
  } as unknown as HttpContext;
  const response = new HttpResponse(native, ctx);
  response.closeUnfinishedRequest();
  return response;
}

describe("HttpResponse.closeUnfinishedRequest — HTTP/1.1, corps non lu", () => {
  it("corps déclaré ≤ 256 Kio : connexion gardée (Node le vide, borné par la longueur)", () => {
    const r = respond({ "content-length": String(UNREAD_BODY_DRAIN_LIMIT) });
    expect(r.getHeader("connection")).to.equal(undefined);
  });

  it("corps déclaré > 256 Kio : `connection: close`", () => {
    const r = respond({
      "content-length": String(UNREAD_BODY_DRAIN_LIMIT + 1),
    });
    expect(r.getHeader("connection")).to.equal("close");
  });

  it("longueur inconnue (`transfer-encoding: chunked`) : `connection: close`", () => {
    const r = respond({ "transfer-encoding": "chunked" });
    expect(r.getHeader("connection")).to.equal("close");
  });

  it("ni longueur ni codage (GET) : corps vide, connexion gardée", () => {
    const r = respond({});
    expect(r.getHeader("connection")).to.equal(undefined);
  });

  it("corps entièrement reçu : rien à décider, même gros", () => {
    const r = respond(
      { "content-length": String(10 * 1024 * 1024) },
      {
        complete: true,
      },
    );
    expect(r.getHeader("connection")).to.equal(undefined);
  });

  it("en-têtes déjà partis : sans effet (rien ne peut plus être posé)", () => {
    const r = respond(
      { "transfer-encoding": "chunked" },
      {
        headersSent: true,
      },
    );
    expect(r.getHeader("connection")).to.equal(undefined);
  });

  it("`connection: close` : la socket se ferme PAR ÉTAPES — fin d'écriture, lecture continuée, destruction au silence", () => {
    const calls: string[] = [];
    let idle: (() => void) | null = null;
    let idleMs = 0;
    const socket = Object.assign(new EventEmitter(), {
      destroySoon: () => calls.push("destroySoon natif"),
      end: () => calls.push("end"),
      destroy: () => calls.push("destroy"),
      setTimeout: (ms: number, cb: () => void) => {
        idleMs = ms;
        idle = cb;
      },
    }) as unknown as net.Socket;
    respond({ "transfer-encoding": "chunked" }, { socket });
    // Ce que Node appelle quand la réponse `connection: close` est écrite.
    socket.destroySoon();
    expect(calls).toEqual(["end"]);
    expect(idleMs).to.equal(UNREAD_BODY_LINGER_MS);
    (idle as (() => void) | null)?.();
    expect(calls).toEqual(["end", "destroy"]);
  });

  it("connexion gardée : la socket n'est pas touchée", () => {
    const original = (): void => undefined;
    const socket = { destroySoon: original } as unknown as net.Socket;
    respond({ "content-length": "10" }, { socket });
    expect(socket.destroySoon).to.equal(original);
  });
});
