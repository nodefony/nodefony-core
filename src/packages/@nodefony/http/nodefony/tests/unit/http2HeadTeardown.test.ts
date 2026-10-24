/// <reference types="node" />
/**
 * Une requête HEAD sur HTTP/2 doit TERMINER sa réponse de compatibilité.
 *
 * Constaté sur Node 26 : pour un HEAD, `stream.respond()` force la fin du flux
 * (`headRequest`), et la réponse de compatibilité (`Http2ServerResponse`) n'émet
 * ensuite NI `finish` NI `close`. Or tout le démontage d'une requête est branché
 * sur ce `close` (`HttpKernel.createHttpContext`) : ligne d'accès, profil, hooks
 * d'après-réponse, et la libération du scope DI. Sans lui, chaque HEAD en HTTP/2
 * retenait son contexte et n'apparaissait dans aucun journal. Les statuts que Node
 * termine aussi d'office (204, 205, 304) émettent, eux, leur `close` : seul HEAD
 * est concerné, et c'est ce que les cas ci-dessous bornent.
 */
import { expect } from "vitest";
import { EventEmitter } from "node:events";
import Http2Response from "../../src/context/http2/Response";

/** Flux HTTP/2 tel que Node le laisse après `respond()`. */
class StreamAfterRespond extends EventEmitter {
  id = 1;
  pushAllowed = false;
  headersSent = true;
  closed = false;
  ended: unknown[] = [];
  constructor(
    public writable: boolean,
    public writableEnded: boolean,
    public destroyed = false,
  ) {
    super();
  }
  end(chunk?: unknown) {
    this.ended.push(chunk);
    return this;
  }
}

/** Réponse de compatibilité : compte ses `end()`. */
class CompatResponse extends EventEmitter {
  writableEnded = false;
  ends = 0;
  constructor(public stream: StreamAfterRespond) {
    super();
  }
  end() {
    this.ends += 1;
    this.writableEnded = true;
    return this;
  }
}

function make(method: string, stream: StreamAfterRespond, redirect = false) {
  const compat = new CompatResponse(stream);
  const response = new Http2Response(
    compat as never,
    {
      isRedirect: redirect,
      httpKernel: null,
      type: "http",
      method,
      log: () => undefined,
    } as never,
  );
  return { compat, response };
}

describe("Http2Response — un HEAD termine sa réponse de compatibilité", () => {
  it("HEAD : le flux est clos par respond(), send() termine la réponse de compat", () => {
    const { compat, response } = make(
      "HEAD",
      new StreamAfterRespond(false, true),
    );
    void response.send(undefined, "utf-8", false);
    expect(compat.ends, "sans ce end, ni finish ni close").to.equal(1);
  });

  it("HEAD redirigé : end() termine aussi la réponse de compat", () => {
    const { compat, response } = make(
      "HEAD",
      new StreamAfterRespond(false, true),
      true,
    );
    void response.send(undefined, "utf-8", false);
    expect(compat.ends).to.equal(1);
  });

  it("HEAD : un second appel ne re-termine pas", () => {
    const { compat, response } = make(
      "HEAD",
      new StreamAfterRespond(false, true),
    );
    void response.send(undefined, "utf-8", false);
    void response.end();
    expect(compat.ends).to.equal(1);
  });

  it("GET 204 (flux clos d'office par Node) : la compat n'est pas touchée — son close vient seul", () => {
    const { compat, response } = make(
      "GET",
      new StreamAfterRespond(false, true),
    );
    void response.send(undefined, "utf-8", false);
    expect(compat.ends).to.equal(0);
  });

  it("HEAD dont le client est parti (flux détruit) : rien n'est terminé", () => {
    const { compat, response } = make(
      "HEAD",
      new StreamAfterRespond(false, false, true),
    );
    void response.send(undefined, "utf-8", false);
    expect(compat.ends).to.equal(0);
  });
});
