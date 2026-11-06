/// <reference types="node" />
/**
 * Scope de requête orphelin côté HTTP (#482).
 *
 * `handle()` ouvre le scope `request` AVANT `new HttpContext`. Le seul
 * déclencheur de `leaveScope` est le `response.once("close")` posé APRÈS la
 * construction du contexte : si le constructeur lève, ce listener n'existe
 * jamais et le scope reste épinglé dans le bucket du conteneur — fuite
 * permanente, une par requête ratée. Le WS a déjà son remède
 * (`releaseOrphanWsScope`) ; ce test prouve que le HTTP libère aussi.
 *
 * Sans contexte, `onError` n'a rien sur quoi écrire : la réponse BRUTE doit
 * recevoir un 500, sinon HTTP/1.1 coupe la connexion sans un octet et HTTP/2
 * laisse le flux pendu (vécu : `Cookie: a=50%25`, #736).
 *
 * Montage minimal : `Object.create(HttpKernel.prototype)` + un VRAI conteneur
 * du core, `HttpContext` remplacé par un constructeur qui lève. On passe par
 * le vrai `createHttpContext` et le vrai `catch` de `handleHttp`.
 */
import { expect } from "vitest";
import { vi } from "vitest";
import { Container } from "nodefony";
import HttpKernel from "../../service/http-kernel.js";

vi.mock("../../src/context/http/HttpContext", () => ({
  default: class {
    constructor() {
      throw new Error("construction du contexte impossible");
    }
  },
}));

type HandleHttp = HttpKernel["handleHttp"];

/** Réponse brute minimale : ce que `failHttp` touche, et rien d'autre. */
function rawResponse(headersSent = false) {
  return { headersSent, statusCode: 200, end: vi.fn() };
}

describe("HttpKernel.handleHttp — scope orphelin quand le contexte ne se construit pas", () => {
  it("libère le scope `request` si `new HttpContext` lève, et répond 500 sur la réponse brute", async () => {
    const container = new Container();
    container.addScope("request");
    const scope = container.enterScope("request");
    expect(container.scopeCount("request")).to.equal(1);

    const onError = vi.fn(async () => null);
    const kernel = Object.create(HttpKernel.prototype) as Record<
      string,
      unknown
    >;
    kernel.container = container;
    kernel.log = () => undefined;
    kernel.onError = onError;

    const response = rawResponse();
    const handleHttp = HttpKernel.prototype.handleHttp;
    await handleHttp.call(
      kernel as unknown as HttpKernel,
      scope,
      {} as Parameters<HandleHttp>[1],
      response as unknown as Parameters<HandleHttp>[2],
      "http",
    );

    // L'erreur suit toujours son chemin normal…
    expect(onError.mock.calls.length).to.equal(1);
    // …le scope ne survit pas à la requête…
    expect(container.scopeCount("request")).to.equal(0);
    // …et le client reçoit une réponse.
    expect(response.statusCode).to.equal(500);
    expect(response.end.mock.calls.length).to.equal(1);
  });

  it("n'écrit rien si les en-têtes sont déjà partis", async () => {
    const container = new Container();
    container.addScope("request");
    const scope = container.enterScope("request");
    const kernel = Object.create(HttpKernel.prototype) as Record<
      string,
      unknown
    >;
    kernel.container = container;
    kernel.log = () => undefined;
    kernel.onError = vi.fn(async () => null);

    const response = rawResponse(true);
    await HttpKernel.prototype.handleHttp.call(
      kernel as unknown as HttpKernel,
      scope,
      {} as Parameters<HandleHttp>[1],
      response as unknown as Parameters<HandleHttp>[2],
      "http",
    );
    expect(response.statusCode).to.equal(200);
    expect(response.end.mock.calls.length).to.equal(0);
  });
});
