/// <reference types="node" />
import { expect } from "vitest";
import net from "node:net";
import HttpContext, {
  routeSocketTimeout,
} from "../../src/context/http/HttpContext.js";

// T3 (profil delta vs Express) — mécanisme socket-timeout de HttpContext.setTimeout :
//   - h1 : AUCUN écouteur sur la socket — l'écouteur `timeout` du SERVEUR
//     (`routeSocketTimeout`) route vers le context ACTIF via WeakMap. Un écouteur
//     par socket faisait créer un tableau d'écouteurs par connexion, site que V8
//     finissait par basculer dans le vieux tas (régime GC dégradé, +45 % CPU/req) ;
//   - re-arm CONDITIONNEL : node écrase le timeout aux transitions keep-alive
//     (server.timeout 120 s / keepAliveTimeout 5 s) → si `socket.timeout !== ms`
//     on ré-arme, sinon 0 appel. Le bug couvert : un arm « 1× par socket » naïf
//     laissait les requêtes keep-alive 2+ à 120 s au lieu du responseTimeout.
//   - h2 (response.stream) : per-stream historique conservé.

interface FakeSocket extends net.Socket {
  timeout: number | undefined;
  setTimeoutCalls: number[];
  listeners: Record<string, Array<() => void>>;
  setTimeout(ms: number): void;
  on(ev: string, cb: () => void): void;
  fireTimeout(): void;
  destroyed: number;
}

// Une VRAIE `net.Socket` par son prototype (le routeur ignore tout le reste),
// sans descripteur ni connexion : propriétés propres posées par-dessus.
function makeSocket(): FakeSocket {
  const socket = Object.create(net.Socket.prototype) as FakeSocket;
  Object.defineProperties(socket, {
    timeout: { value: undefined, writable: true },
    setTimeoutCalls: { value: [] },
    listeners: { value: {} },
    setTimeout: {
      value(this: FakeSocket, ms: number) {
        this.timeout = ms;
        this.setTimeoutCalls.push(ms);
      },
    },
    on: {
      value(this: FakeSocket, ev: string, cb: () => void) {
        (this.listeners[ev] ??= []).push(cb);
      },
    },
    // Ce que fait Node : `socketOnTimeout` → `server.emit("timeout", socket)`.
    fireTimeout: {
      value(this: FakeSocket) {
        routeSocketTimeout(this);
      },
    },
    destroyed: { value: 0, writable: true },
    destroy: {
      value(this: FakeSocket) {
        this.destroyed++;
      },
    },
  });
  return socket;
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
  it("1re requête : arme le socket à responseTimeout, AUCUN écouteur sur la socket", () => {
    const s = makeSocket();
    makeCtx(s).setTimeout();
    expect(s.setTimeoutCalls).to.deep.equal([30000]);
    expect(s.listeners["timeout"]).to.equal(undefined);
  });

  it("requête suivante, timeout intact → 0 re-arm, toujours aucun écouteur", () => {
    const s = makeSocket();
    makeCtx(s).setTimeout();
    makeCtx(s).setTimeout(); // requête 2, socket.timeout === 30000
    expect(s.setTimeoutCalls).to.have.lengthOf(1);
    expect(s.listeners["timeout"]).to.equal(undefined);
  });

  it("node a écrasé le timeout (cycle keep-alive) → re-arm au responseTimeout (LE bug couvert)", () => {
    const s = makeSocket();
    makeCtx(s).setTimeout();
    // node : resOnFinish → keepAliveTimeout, nouvelle requête → server.timeout
    s.timeout = 120000;
    makeCtx(s).setTimeout(); // requête 2
    expect(s.timeout).to.equal(30000, "requêtes 2+ gardent responseTimeout");
    expect(s.setTimeoutCalls).to.deep.equal([30000, 30000]);
    expect(s.listeners["timeout"]).to.equal(
      undefined,
      "toujours aucun écouteur sur la socket",
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

  // Socket INACTIF (keep-alive entre deux requêtes) : le serveur passe un
  // callback à `server.setTimeout`, donc Node ne détruit plus le socket — le
  // gestionnaire doit le fermer, sinon `keepAliveTimeout` reste lettre morte.
  it("socket idle (context actif terminé) → fermé, sans 408", () => {
    const s = makeSocket();
    const ctx = makeCtx(s, { ended: true });
    ctx.setTimeout();
    s.fireTimeout();
    expect(ctx.fired).to.equal(0);
    expect(s.destroyed).to.equal(1);
  });

  it("socket idle après clean() (response.response = null) → fermé, sans 408", () => {
    const s = makeSocket();
    const ctx = makeCtx(s);
    ctx.setTimeout();
    // clean() : `response.response` passe à null, `cleaned` à true — l'ancien
    // test `!response.response?.writableEnded` prenait ce contexte MORT pour
    // actif.
    (ctx as unknown as { cleaned: boolean }).cleaned = true;
    (ctx as unknown as { response: { response: null } }).response.response =
      null;
    s.fireTimeout();
    expect(ctx.fired).to.equal(0);
    expect(s.destroyed).to.equal(1);
  });

  it("requête active → 408, socket NON fermé par le gestionnaire", () => {
    const s = makeSocket();
    const ctx = makeCtx(s);
    ctx.setTimeout();
    s.fireTimeout();
    expect(ctx.fired).to.equal(1);
    expect(s.destroyed).to.equal(0);
  });

  it("une session HTTP/2 (même événement sur un serveur allowHTTP1) est ignorée", () => {
    let destroyed = 0;
    routeSocketTimeout({ destroy: () => destroyed++ });
    expect(destroyed).to.equal(0);
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

// Une action qui rend `null` sans rien envoyer laisse la requête attendre son
// délai d'expiration. L'avertissement de développement vivait au SEUL
// démontage — où `sended` était déjà vrai, puisque le timeout venait d'envoyer
// son 504 : il ne partait jamais dans le cas même qu'il devait signaler.
describe("HttpContext._onTimeout — l'action muette se signale AVANT la réponse d'expiration", () => {
  it("🔴 warnUnsentResponse est appelé avant onError", () => {
    const order: string[] = [];
    const ctx = Object.create(HttpContext.prototype) as HttpContext;
    Object.assign(ctx, {
      listenerCount: () => 0,
      _abortIfPending: () => undefined,
      response: { stream: {} },
      httpKernel: {
        warnUnsentResponse: () => order.push("warn"),
        onError: () => {
          order.push("onError");
          return Promise.resolve();
        },
      },
    });
    ctx._onTimeout();
    expect(order).to.deep.equal(["warn", "onError"]);
  });
});
