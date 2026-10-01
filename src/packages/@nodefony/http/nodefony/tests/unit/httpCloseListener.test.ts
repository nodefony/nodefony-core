/// <reference types="node" />
/**
 * UN écouteur `close` par requête, posé par `on` et non `once`.
 *
 * Une `ServerResponse` émet `close` une seule fois, puis elle est jetée avec
 * son écouteur. `once` n'apporte donc rien, et coûte à chaque requête une
 * enveloppe allouée puis un `removeListener` au déclenchement (~3 µs/req au
 * profil sous charge).
 */
import { expect } from "vitest";
import { EventEmitter } from "node:events";
import { beforeAll, vi } from "vitest";
import { Container } from "nodefony";
import type HttpKernelType from "../../service/http-kernel.js";

// La suite tourne en `isolate: false` : un autre fichier a pu charger le VRAI
// HttpContext avant celui-ci, et un `vi.mock` hissé ne remplace pas un module
// déjà en cache (rouge en CI, vert en local selon l'ordre des fichiers). On
// purge le cache, on pose le faux, PUIS on importe le noyau.
let HttpKernel: typeof HttpKernelType;
beforeAll(async () => {
  vi.resetModules();
  vi.doMock("../../src/context/http/HttpContext", () => ({
    default: class {
      sended = false;
      response = { statusCode: 200 };
      _abortIfPending() {}
    },
  }));
  HttpKernel = (await import("../../service/http-kernel.js")).default;
});

type CreateHttpContext = HttpKernelType["createHttpContext"];

function setup() {
  const container = new Container();
  container.addScope("request");
  const scope = container.enterScope("request");
  const teardown = vi.fn(async () => undefined);
  const kernel = Object.create(HttpKernel.prototype) as Record<string, unknown>;
  kernel.container = container;
  kernel.log = () => undefined;
  kernel.teardownHttp = teardown;
  const response = new EventEmitter() as EventEmitter & {
    writableEnded: boolean;
  };
  response.writableEnded = true;
  HttpKernel.prototype.createHttpContext.call(
    kernel as unknown as HttpKernelType,
    scope,
    {} as Parameters<CreateHttpContext>[1],
    response as unknown as Parameters<CreateHttpContext>[2],
    "http",
  );
  return { response, teardown };
}

describe("HttpKernel.createHttpContext — écouteur de fin de réponse", () => {
  it("un seul écouteur `close`, sans enveloppe `once`", () => {
    const { response } = setup();
    const raw = response.rawListeners("close") as Array<{ listener?: unknown }>;
    expect(raw).to.have.length(1);
    expect(raw[0]!.listener, "enveloppe once détectée").to.equal(undefined);
  });

  it("close → teardown une fois, sans removeListener", () => {
    const { response, teardown } = setup();
    const spy = vi.spyOn(response, "removeListener");
    response.emit("close");
    expect(teardown.mock.calls.length).to.equal(1);
    expect(spy.mock.calls.length).to.equal(0);
  });
});
