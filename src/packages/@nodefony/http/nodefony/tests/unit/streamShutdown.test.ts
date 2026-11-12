/// <reference types="node" />
//
// ─── Arrêt du serveur : les flux longs reçoivent leur fin (#695) ────────────
//
// ADR-0026 D8, critère 33 : à `onTerminate`, AVANT le drain des connexions, le
// noyau termine chaque flux long ouvert — SSE, flux RPC, flux d'octets vivants
// — au lieu de le laisser détruire sans un mot à `shutdownTimeout`. Un appel
// RPC se termine au format de son protocole (gRPC : 14), sans second écrivain
// ni minuteur de plus ; un flux SSE par une fin simple.
//
// Débrancher (chacun fait tomber au moins un cas) :
//   - `StreamLifecycle.shutdown` : l'appel à `rpc.shutdown()` (close à la place) ;
//   - `ShutdownRegistry.shutdown` : la boucle qui termine chaque flux ;
//   - `ShutdownRegistry.delete` : la fin de l'attente au dernier retiré ;
//   - `ShutdownRegistry.add` : le flux inscrit pendant l'arrêt ;
//   - `StreamLifecycle` : l'inscription (`trackStream`) ou le retrait.
//
import http from "node:http";
import net from "node:net";
import { afterEach, beforeEach, expect, vi } from "vitest";
import {
  ShutdownRegistry,
  StreamLifecycle,
  type IShutdownStream,
} from "../../src/context/http/StreamLifecycle";
import type HttpContext from "../../src/context/http/HttpContext";
import type { IRpcCall } from "../../interfaces/IRpcCall";

/** Fiche d'appel doublure : compte ses arrêts. */
class RecordingCall implements IRpcCall {
  readonly system = "grpc";
  readonly method = "test.v1.Svc/Call";
  readonly code = null;
  readonly codeName = null;
  stopped = 0;
  expire(): void {}
  revoke(): void {}
  shutdown(): void {
    this.stopped += 1;
  }
  settle(): Error | null {
    return null;
  }
}

/** Le registre du noyau, réduit à ce que la brique appelle. */
function kernelWith(registry: ShutdownRegistry) {
  return {
    trackStream: (s: StreamLifecycle) => registry.add(s),
    untrackStream: (s: StreamLifecycle) => registry.delete(s),
  };
}

function open(options: {
  foreignWriter: boolean;
  rpc: IRpcCall | null;
  endsAtShutdown?: boolean;
  registry?: ShutdownRegistry;
}) {
  const response = new http.ServerResponse(
    new http.IncomingMessage(new net.Socket()),
  );
  const closes: number[] = [];
  const context = {
    rpc: options.rpc,
    httpKernel:
      options.registry === undefined ? null : kernelWith(options.registry),
    close: () => {
      closes.push(1);
    },
  };
  const lifecycle = new StreamLifecycle(
    // Doublure : seuls `rpc`, `httpKernel` et `close` sont lus par la brique.
    context as unknown as HttpContext,
    response,
    response,
    {
      stallTimeout: false,
      maxDuration: false,
      revalidate: null,
      identifier: null,
      foreignWriter: options.foreignWriter,
      endsAtShutdown: options.endsAtShutdown ?? true,
    },
  );
  return { lifecycle, response, closes };
}

/** Un flux factice : se retire du registre quand on le termine, ou jamais. */
function fakeStream(
  registry: ShutdownRegistry,
  mode: "sync" | "later" | "deaf",
): IShutdownStream & { calls: number; end(): void } {
  const stream = {
    calls: 0,
    end: () => registry.delete(stream),
    shutdown: () => {
      stream.calls += 1;
      if (mode === "sync") stream.end();
    },
  };
  registry.add(stream);
  return stream;
}

describe("StreamLifecycle.shutdown — arrêt du serveur (critère 33, ADR-0026 D8)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("appel RPC : terminé AU FORMAT du protocole, transport intact, aucun minuteur", () => {
    const call = new RecordingCall();
    const { lifecycle, response } = open({ foreignWriter: true, rpc: call });
    void lifecycle.shutdown();
    expect(call.stopped).to.equal(1);
    expect(response.destroyed, "aucune coupure muette").to.equal(false);
    expect(lifecycle.closed, "l'adaptateur termine l'appel").to.equal(false);
    expect(lifecycle.cause).to.equal("server");
    expect(
      vi.getTimerCount(),
      "le filet est le drain, pas un minuteur",
    ).to.equal(0);
  });

  it("tiers sans appel RPC : transport détruit aussitôt (comme `close`)", () => {
    const { lifecycle, response } = open({ foreignWriter: true, rpc: null });
    void lifecycle.shutdown();
    expect(response.destroyed).to.equal(true);
    expect(lifecycle.closed).to.equal(true);
  });

  it("flux écrit par la brique (SSE) : terminé par `context.close()`", () => {
    const { lifecycle, closes } = open({
      foreignWriter: false,
      rpc: new RecordingCall(),
    });
    void lifecycle.shutdown();
    expect(closes).to.have.length(1);
    expect(lifecycle.closed).to.equal(true);
  });

  it("flux déjà fermé : rien", () => {
    const call = new RecordingCall();
    const { lifecycle, closes } = open({ foreignWriter: true, rpc: call });
    lifecycle.finish();
    void lifecycle.shutdown();
    expect(call.stopped).to.equal(0);
    expect(closes).to.have.length(0);
  });

  it("inscrit au registre à l'ouverture, retiré à la fermeture", () => {
    const registry = new ShutdownRegistry();
    const { lifecycle } = open({
      foreignWriter: false,
      rpc: null,
      registry,
    });
    expect(registry.size).to.equal(1);
    lifecycle.finish();
    expect(registry.size).to.equal(0);
  });

  it("contexte nettoyé AVANT la fin (`Context.clean` remet `httpKernel` à null) : le flux quitte TOUS les registres", () => {
    // Vécu sur le fil : le nettoyage du contexte passe au `close` AVANT celui
    // du flux ; relu sur le contexte, le noyau était `null` et les flux gRPC
    // fermés restaient inscrits — avec leur contexte — à la révocation, au
    // balayage et à l'arrêt.
    const registries = {
      watch: new Set<unknown>(),
      sweep: new Set<unknown>(),
      track: new Set<unknown>(),
    };
    const kernel = {
      watchStream: (s: unknown) => registries.watch.add(s),
      unwatchStream: (s: unknown) => registries.watch.delete(s),
      sweepStall: (s: unknown) => registries.sweep.add(s),
      unsweepStall: (s: unknown) => registries.sweep.delete(s),
      trackStream: (s: unknown) => registries.track.add(s),
      untrackStream: (s: unknown) => registries.track.delete(s),
    };
    const response = new http.ServerResponse(
      new http.IncomingMessage(new net.Socket()),
    );
    const context: { httpKernel: typeof kernel | null; rpc: null } = {
      httpKernel: kernel,
      rpc: null,
    };
    const lifecycle = new StreamLifecycle(
      context as unknown as HttpContext,
      response,
      response,
      {
        stallTimeout: 60_000,
        maxDuration: false,
        revalidate: () => Promise.resolve(true),
        identifier: "alice",
        foreignWriter: true,
        endsAtShutdown: true,
      },
    );
    expect(Object.values(registries).map((r) => r.size)).to.deep.equal([
      1, 1, 1,
    ]);
    context.httpKernel = null;
    lifecycle.finish();
    expect(Object.values(registries).map((r) => r.size)).to.deep.equal([
      0, 0, 0,
    ]);
  });

  it("source FINIE (`endsAtShutdown: false`) : hors registre, elle a le drain pour finir", () => {
    const registry = new ShutdownRegistry();
    open({ foreignWriter: false, rpc: null, registry, endsAtShutdown: false });
    expect(registry.size).to.equal(0);
  });

  it("le registre termine un vrai SSE : la fermeture le retire, l'attente est nulle", () => {
    const registry = new ShutdownRegistry();
    const { closes } = open({ foreignWriter: false, rpc: null, registry });
    expect(registry.shutdown(1000)).to.equal(0);
    expect(closes).to.have.length(1);
    expect(registry.size).to.equal(0);
  });
});

describe("ShutdownRegistry — l'arrêt attend la fin des flux, borné", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("aucun flux : rien à attendre", () => {
    expect(new ShutdownRegistry().shutdown(1000)).to.equal(0);
  });

  it("chaque flux est terminé une fois ; fermés sur le coup : rien à attendre", () => {
    const registry = new ShutdownRegistry();
    const a = fakeStream(registry, "sync");
    const b = fakeStream(registry, "sync");
    expect(registry.shutdown(1000)).to.equal(0);
    expect([a.calls, b.calls]).to.deep.equal([1, 1]);
  });

  it("fermés plus tard : l'attente finit avec le dernier, minuteur arrêté", async () => {
    const registry = new ShutdownRegistry();
    const a = fakeStream(registry, "later");
    const b = fakeStream(registry, "later");
    const waiting = registry.shutdown(1000);
    expect(waiting).to.be.instanceOf(Promise);
    a.end();
    expect(vi.getTimerCount()).to.equal(1);
    b.end();
    expect(vi.getTimerCount(), "l'attente ne retient plus rien").to.equal(0);
    expect(await waiting).to.equal(0);
  });

  it("gestionnaire SOURD : l'attente va à son terme, pas avant, et compte les restants", async () => {
    const registry = new ShutdownRegistry();
    fakeStream(registry, "sync");
    fakeStream(registry, "deaf");
    let settled: number | null = null;
    const waiting = registry.shutdown(1000);
    if (typeof waiting === "number") throw new Error("attente attendue");
    void waiting.then((left) => {
      settled = left;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(settled).to.equal(null);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).to.equal(1);
  });

  it("flux ouvert PENDANT l'arrêt : terminé au tour suivant, pas dans l'ouverture", () => {
    const registry = new ShutdownRegistry();
    void registry.shutdown(1000);
    const late = fakeStream(registry, "sync");
    expect(late.calls, "son appel n'est pas encore relié").to.equal(0);
    vi.runOnlyPendingTimers();
    expect(late.calls).to.equal(1);
    expect(registry.size).to.equal(0);
  });

  it("hors arrêt : une inscription ne termine rien", () => {
    const registry = new ShutdownRegistry();
    const s = fakeStream(registry, "sync");
    vi.runOnlyPendingTimers();
    expect(s.calls).to.equal(0);
    expect(registry.size).to.equal(1);
  });
});
