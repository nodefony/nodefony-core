/// <reference types="node" />
//
// ─── Révocation d'un flux dont un adaptateur RPC tient les écritures (#695) ──
//
// ADR-0026 D6, critère 31 : à la mort de l'identité, le registre du noyau
// appelle `StreamLifecycle.revoke()`. Un appel RPC se termine alors AU FORMAT
// de son protocole (`HttpContext.rpc.revoke`, gRPC : 16) — jamais par
// `context.close()` (second écrivain) ni par une coupure muette ; un
// gestionnaire sourd est détruit à la fenêtre de re-validation suivante.
//
// Débrancher (chacun fait tomber au moins un cas) :
//   - `revoke` : l'appel à `rpc.revoke()` (coupure immédiate à la place) ;
//   - `revoke` : le minuteur de la fenêtre ;
//   - `finish` : l'arrêt de ce minuteur.
//
import http from "node:http";
import net from "node:net";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { REVOCATION_REVALIDATE_MS } from "nodefony";
import { StreamLifecycle } from "../../src/context/http/StreamLifecycle";
import type HttpContext from "../../src/context/http/HttpContext";
import type { IRpcCall } from "../../interfaces/IRpcCall";

/** Fiche d'appel doublure : compte ses révocations. */
class RecordingCall implements IRpcCall {
  revoked = 0;
  expire(): void {}
  revoke(): void {
    this.revoked += 1;
  }
}

function open(options: { foreignWriter: boolean; rpc: IRpcCall | null }) {
  const response = new http.ServerResponse(
    new http.IncomingMessage(new net.Socket()),
  );
  const closes: number[] = [];
  const context = {
    rpc: options.rpc,
    httpKernel: null,
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
    },
  );
  return { lifecycle, response, closes };
}

describe("StreamLifecycle.revoke — identité morte (critère 31, ADR-0026 D6)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("appel RPC : terminé AU FORMAT du protocole, transport intact, une seule fois", () => {
    const call = new RecordingCall();
    const { lifecycle, response } = open({ foreignWriter: true, rpc: call });
    void lifecycle.revoke();
    void lifecycle.revoke();
    expect(call.revoked).to.equal(1);
    expect(response.destroyed, "aucune coupure muette").to.equal(false);
    expect(lifecycle.closed).to.equal(false);
    expect(lifecycle.cause).to.equal("server");
  });

  it("gestionnaire sourd : détruit à la fenêtre de re-validation suivante, pas avant", () => {
    const { lifecycle, response } = open({
      foreignWriter: true,
      rpc: new RecordingCall(),
    });
    void lifecycle.revoke();
    vi.advanceTimersByTime(REVOCATION_REVALIDATE_MS - 1);
    expect(response.destroyed).to.equal(false);
    vi.advanceTimersByTime(1);
    expect(response.destroyed).to.equal(true);
    expect(lifecycle.closed).to.equal(true);
  });

  it("appel qui se termine dans la fenêtre : minuteur arrêté, rien n'est détruit", () => {
    const { lifecycle, response } = open({
      foreignWriter: true,
      rpc: new RecordingCall(),
    });
    void lifecycle.revoke();
    expect(vi.getTimerCount()).to.equal(1);
    lifecycle.finish();
    expect(vi.getTimerCount(), "le flux ne se retient plus").to.equal(0);
    vi.advanceTimersByTime(REVOCATION_REVALIDATE_MS);
    expect(response.destroyed).to.equal(false);
  });

  it("tiers sans appel RPC : transport détruit aussitôt (comme `close`)", () => {
    const { lifecycle, response } = open({ foreignWriter: true, rpc: null });
    void lifecycle.revoke();
    expect(response.destroyed).to.equal(true);
    expect(lifecycle.closed).to.equal(true);
  });

  it("flux écrit par la brique (SSE) : la requête est terminée par `context.close()`", () => {
    const { lifecycle, closes } = open({
      foreignWriter: false,
      rpc: new RecordingCall(),
    });
    void lifecycle.revoke();
    expect(closes).to.have.length(1);
    expect(lifecycle.closed).to.equal(true);
  });
});
