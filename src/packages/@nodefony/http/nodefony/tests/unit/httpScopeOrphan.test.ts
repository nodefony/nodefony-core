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
 * Montage minimal : `Object.create(HttpKernel.prototype)` + un VRAI conteneur
 * du core, `HttpContext` remplacé par un constructeur qui lève. On passe par
 * le vrai `createHttpContext` et le vrai `catch` de `handleHttp`.
 */
import { expect } from "chai";
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

describe("HttpKernel.handleHttp — scope orphelin quand le contexte ne se construit pas", () => {
  it("libère le scope `request` si `new HttpContext` lève", async () => {
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

    const handleHttp = HttpKernel.prototype.handleHttp as HandleHttp;
    await handleHttp.call(
      kernel as unknown as HttpKernel,
      scope,
      {} as Parameters<HandleHttp>[1],
      {} as Parameters<HandleHttp>[2],
      "http" as Parameters<HandleHttp>[3],
    );

    // L'erreur suit toujours son chemin normal…
    expect(onError.mock.calls.length).to.equal(1);
    // …et le scope ne survit pas à la requête.
    expect(container.scopeCount("request")).to.equal(0);
  });
});
