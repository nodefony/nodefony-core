/// <reference types="node" />
import { expect } from "chai";
import HttpContext from "../../src/context/http/HttpContext.js";

// T3 (profil delta vs Express) — mécanisme socket-timeout de HttpContext.setTimeout :
//   - h1 : 1 closure handler PAR SOCKET (plus une par requête), routée vers le
//     context ACTIF via WeakMap ;
//   - re-arm CONDITIONNEL : node écrase le timeout aux transitions keep-alive
//     (server.timeout 120 s / keepAliveTimeout 5 s) → si `socket.timeout !== ms`
//     on ré-arme, sinon 0 appel. Le bug couvert : un arm « 1× par socket » naïf
//     laissait les requêtes keep-alive 2+ à 120 s au lieu du responseTimeout.
//   - h2 (response.stream) : per-stream historique conservé.

interface FakeSocket {
  timeout: number | undefined;
  setTimeoutCalls: number[];
  listeners: Record<string, Array<() => void>>;
  setTimeout(ms: number): void;
  on(ev: string, cb: () => void): void;
  fireTimeout(): void;
}

function makeSocket(): FakeSocket {
  return {
    timeout: undefined,
    setTimeoutCalls: [],
    listeners: {},
    setTimeout(ms: number) {
      this.timeout = ms;
      this.setTimeoutCalls.push(ms);
    },
    on(ev: string, cb: () => void) {
      (this.listeners[ev] ??= []).push(cb);
    },
    fireTimeout() {
      for (const cb of this.listeners["timeout"] ?? []) cb();
    },
  };
}

// Context minimal : setTimeout() ne lit que this.response — pas besoin du ctor
// complet (pattern proxy des tests Router).
function makeCtx(
  socket: FakeSocket,
  opts: { timeout?: number; ended?: boolean } = {},
): HttpContext & { fired: number } {
  const ctx = Object.create(HttpContext.prototype) as HttpContext & {
    fired: number;
  };
  ctx.fired = 0;
  // T4 : les handlers appellent `_onTimeout()` en direct (plus de fire/once
  // par requête) — le mock compte les déclenchements du chemin timeout.
  (ctx as unknown as { _onTimeout: () => void })._onTimeout = () => {
    ctx.fired++;
  };
  (ctx as unknown as { response: unknown }).response = {
    timeout: opts.timeout ?? 30000,
    response: {
      socket,
      writableEnded: opts.ended ?? false,
    },
  };
  return ctx;
}

describe("HttpContext.setTimeout — socket timeout T3 (h1)", () => {
  it("1re requête : arme le socket à responseTimeout + 1 handler", () => {
    const s = makeSocket();
    makeCtx(s).setTimeout();
    expect(s.setTimeoutCalls).to.deep.equal([30000]);
    expect(s.listeners["timeout"]).to.have.lengthOf(1);
  });

  it("requête suivante, timeout intact → 0 re-arm, 0 handler ajouté", () => {
    const s = makeSocket();
    makeCtx(s).setTimeout();
    makeCtx(s).setTimeout(); // requête 2, socket.timeout === 30000
    expect(s.setTimeoutCalls).to.have.lengthOf(1);
    expect(s.listeners["timeout"]).to.have.lengthOf(1);
  });

  it("node a écrasé le timeout (cycle keep-alive) → re-arm au responseTimeout (LE bug couvert)", () => {
    const s = makeSocket();
    makeCtx(s).setTimeout();
    // node : resOnFinish → keepAliveTimeout, nouvelle requête → server.timeout
    s.timeout = 120000;
    makeCtx(s).setTimeout(); // requête 2
    expect(s.timeout).to.equal(30000, "requêtes 2+ gardent responseTimeout");
    expect(s.setTimeoutCalls).to.deep.equal([30000, 30000]);
    expect(s.listeners["timeout"]).to.have.lengthOf(
      1,
      "toujours 1 seul handler",
    );
  });

  it("le timeout route vers le context ACTIF (pas celui de la requête 1)", () => {
    const s = makeSocket();
    const ctx1 = makeCtx(s, { ended: true }); // requête 1 terminée
    ctx1.setTimeout();
    const ctx2 = makeCtx(s); // requête 2 en cours
    s.timeout = 120000;
    ctx2.setTimeout();
    s.fireTimeout();
    expect(ctx1.fired).to.equal(0);
    expect(ctx2.fired).to.equal(1);
  });

  it("socket idle (context actif terminé) → no-op, le handler survit (on, pas once)", () => {
    const s = makeSocket();
    const ctx = makeCtx(s, { ended: true });
    ctx.setTimeout();
    s.fireTimeout(); // idle keep-alive : writableEnded → no-op
    expect(ctx.fired).to.equal(0);
    // le handler n'est PAS consommé : une requête 2 lente garde son 408
    const ctx2 = makeCtx(s);
    (ctx2 as unknown as { response: { timeout: number } }).response.timeout =
      30000;
    ctx2.setTimeout();
    s.fireTimeout();
    expect(ctx2.fired).to.equal(1);
  });

  it("HTTP/2 (response.stream) : per-stream historique — pas de chemin socket", () => {
    const s = makeSocket();
    const ctx = makeCtx(s);
    let streamArmed = 0;
    (ctx as unknown as { response: unknown }).response = {
      timeout: 30000,
      stream: {},
      response: {
        socket: s,
        writableEnded: false,
        setTimeout: () => {
          streamArmed++;
        },
      },
    };
    ctx.setTimeout();
    expect(streamArmed).to.equal(1);
    expect(s.setTimeoutCalls).to.have.lengthOf(0, "socket h1 non touché en h2");
  });
});
