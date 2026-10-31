import assert from "node:assert/strict";
import { beforeEach, describe, it, vi } from "vitest";
import "reflect-metadata";
import type { ISubscriberIdentity, RpcActionHandler } from "nodefony";
import type { ContextType } from "@nodefony/http";
import { RealtimeController } from "../../src/server/RealtimeController";
import {
  getRealtimeHub,
  type FrameAuthorizer,
} from "../../src/server/RealtimeHub";
import { MAX_RETAINED_FRAME_VERDICTS } from "../../src/server/frameAdmission";
import type {
  RealtimeInboundHandler,
  RealtimePublish,
} from "../../interfaces/IRealtimeController";
import type { IRealtimeToken } from "../../interfaces/IRealtimeToken";

/**
 * #622, lot 4 — le verrou des trames (ADR-0022 §6, décision 1 ter).
 *
 * Une trame entrante sur un canal ADMIS — ouvert par `allow`, ou dont le verrou a
 * déjà dit oui — ne consulte plus le verrou. Tout le reste le consulte, et rien
 * de ce qui se retient ne doit pouvoir élargir un droit.
 */

// ── Décor ──────────────────────────────────────────────────────────────────

const ALICE: ISubscriberIdentity = Object.freeze({
  type: "session",
  authenticated: true,
  id: "acc-alice",
  userIdentifier: "alice",
  roles: Object.freeze(["ROLE_USER"]),
  scopes: Object.freeze([]),
  issuer: null,
  account: true,
});

const OPEN = 1;

function makeCtx() {
  const sent: Array<Record<string, unknown>> = [];
  let onFinish: (() => void) | null = null;
  const ctx = {
    type: "websocket",
    connection: {
      readyState: OPEN,
      send: (data: string, cb?: (err?: Error) => void) => {
        sent.push(JSON.parse(data));
        cb?.();
      },
      close: () => {},
    },
    once: (event: string, fn: () => void) => {
      if (event === "onFinish") onFinish = fn;
    },
    request: { headers: {}, url: "/realtime" },
    cookies: {},
    url: "/realtime",
    remoteAddress: "127.0.0.1",
    origin: "",
  };
  return { ctx, sent, fireFinish: () => onFinish?.() };
}

/** Canaux entrants du banc ; `received` compte ce que chaque handler a reçu. */
const INBOUND = ["chat", "free", "room:1", "dup", "nowhere:1"];

class GateRt extends RealtimeController {
  static extraInbound: string[] = [];
  received: Record<string, number> = {};
  constructor(ctx: unknown) {
    super("gate-rt", ctx as ContextType);
  }
  override realtimeInbound(): Record<string, RealtimeInboundHandler> {
    const handlers: Record<string, RealtimeInboundHandler> = {};
    for (const name of [...INBOUND, ...GateRt.extraInbound]) {
      handlers[name] = () => {
        this.received[name] = (this.received[name] ?? 0) + 1;
      };
    }
    return handlers;
  }
  override realtimeActions(): Record<string, RpcActionHandler> {
    return { dup: () => "action", act: () => "action", ping: () => "pong" };
  }
  override realtimeChannels(): string[] {
    return ["tick"];
  }
  override createRealtimeChannel(
    channel: string,
    _publish: RealtimePublish,
  ): (() => void) | null {
    // `nowhere:*` n'a aucun producteur : son abonnement échoue.
    return channel.startsWith("nowhere:") ? null : () => {};
  }
  boot(): void {
    this.handleRealtime(null);
  }
  feed(frame: object): void {
    this.handleRealtime(JSON.stringify({ jsonrpc: "2.0", ...frame }));
  }
  push(method: string): void {
    this.feed({ method, params: { n: 1 } });
  }
  call(method: string, id: number): void {
    this.feed({ id, method, params: {} });
  }
  subscribe(channel: string): void {
    this.feed({ method: "subscribe", params: { channel } });
  }
  unsubscribe(channel: string): void {
    this.feed({ method: "unsubscribe", params: { channel } });
  }
}

const token: IRealtimeToken = {
  type: "session",
  getUserIdentifier: () => "alice",
  isAuthenticated: () => true,
  getRoles: () => ["ROLE_USER"],
  getScopes: () => [],
  getAttribute: () => undefined,
  getIdentity: () => ALICE,
};

/** Verrou espion : compte ses appels par méthode, rend `verdict(method)`. */
function spyLock(verdict: (method: string) => boolean = () => true) {
  const calls: Record<string, number> = {};
  const lock: FrameAuthorizer = (frame) => {
    const method = (frame as { method: string }).method;
    calls[method] = (calls[method] ?? 0) + 1;
    return verdict(method);
  };
  return { lock, calls, count: (m: string) => calls[m] ?? 0 };
}

async function connect(env?: string) {
  getRealtimeHub().useAuthenticator(
    { pattern: "/realtime" },
    { name: "fixe", supports: () => true, authenticate: async () => token },
  );
  const h = makeCtx();
  const rt = new GateRt(h.ctx);
  if (env !== undefined) {
    Object.defineProperty(rt, "kernel", { value: { environment: env } });
  }
  rt.boot();
  await new Promise<void>((resolve) => setImmediate(resolve));
  return { ...h, rt };
}

const denials = (sent: Array<Record<string, unknown>>) =>
  sent
    .filter((f) => f.method === "realtime:denied")
    .map((f) => f.params as Record<string, unknown>);

function stateOf(ctx: object): {
  inbound: Record<string, unknown>;
  admitted: Record<string, boolean> | null;
} {
  const state = (
    ctx as {
      __nfRealtime?: {
        inbound: Record<string, unknown> | null;
        admitted: Record<string, boolean> | null;
      };
    }
  ).__nfRealtime;
  assert.ok(state?.inbound, "état de connexion posé");
  return { inbound: state.inbound, admitted: state.admitted };
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

// ── Trame chaude ───────────────────────────────────────────────────────────

describe("#622 lot 4 — une trame admise ne consulte plus le verrou", () => {
  beforeEach(() => {
    getRealtimeHub().clear();
    GateRt.extraInbound = [];
  });

  it("canal entrant à politique fixe : le verrou dit oui UNE fois, les trames suivantes passent sans lui", async () => {
    const spy = spyLock();
    getRealtimeHub().setFrameAuthorizer(spy.lock);
    const { rt } = await connect();
    for (let i = 0; i < 4; i++) rt.push("chat");
    assert.equal(spy.count("chat"), 1);
    assert.equal(rt.received.chat, 4);
  });

  it("un REFUS n'est jamais retenu : chaque trame repasse par le verrou, et chacune est refusée", async () => {
    const spy = spyLock((m) => m !== "chat");
    getRealtimeHub().setFrameAuthorizer(spy.lock);
    const { rt, sent } = await connect();
    for (let i = 0; i < 3; i++) rt.push("chat");
    assert.equal(spy.count("chat"), 3);
    assert.equal(rt.received.chat, undefined);
    assert.equal(denials(sent).filter((d) => d.channel === "chat").length, 3);
  });

  it("sans verrou posé, le « oui » est retenu aussi — et oublié quand le verrou arrive", async () => {
    const { rt } = await connect();
    rt.push("chat");
    const spy = spyLock(() => false);
    getRealtimeHub().setFrameAuthorizer(spy.lock);
    rt.push("chat");
    assert.equal(
      spy.count("chat"),
      1,
      "le verrou posé après coup est consulté",
    );
    assert.equal(rt.received.chat, 1, "et sa décision s'applique");
  });

  it("plafond : au-delà de 64 verdicts retenus, le verrou est consulté à chaque trame — jamais contourné", async () => {
    const extra = Array.from(
      { length: MAX_RETAINED_FRAME_VERDICTS + 3 },
      (_, i) => `bulk:${i}`,
    );
    GateRt.extraInbound = extra;
    const spy = spyLock();
    getRealtimeHub().setFrameAuthorizer(spy.lock);
    const { rt } = await connect();
    for (const name of extra) rt.push(name);
    for (const name of extra) rt.push(name);
    const retained = extra.filter((name) => spy.count(name) === 1);
    const consulted = extra.filter((name) => spy.count(name) === 2);
    assert.equal(retained.length, MAX_RETAINED_FRAME_VERDICTS);
    assert.deepEqual(consulted, extra.slice(MAX_RETAINED_FRAME_VERDICTS));
    assert.equal(MAX_RETAINED_FRAME_VERDICTS, 64);
  });

  it("la table des admis a la FORME de la table entrante — mêmes clés, même ordre — et n'en gagne jamais", async () => {
    // L'invariant qui garde la lecture chaude monomorphe : toutes les connexions
    // d'un contrôleur partagent une forme d'objet.
    getRealtimeHub().setFrameAuthorizer(spyLock().lock);
    const first = await connect();
    const second = await connect();
    first.rt.push("chat");
    second.rt.push("free");
    for (const name of ["act", "inconnu", "ping", "toString"])
      first.rt.push(name);
    const stateOf = (c: { ctx: object }) =>
      (c.ctx as { __nfRealtime?: { inbound: object; admitted: object | null } })
        .__nfRealtime;
    const a = stateOf(first);
    const b = stateOf(second);
    assert.ok(a?.admitted && b?.admitted);
    assert.deepEqual(Object.keys(a.admitted), Object.keys(a.inbound));
    assert.deepEqual(Object.keys(b.admitted), Object.keys(a.admitted));
    assert.equal((a.admitted as Record<string, boolean>).chat, true);
    assert.equal((a.admitted as Record<string, boolean>).free, false);
    assert.equal((b.admitted as Record<string, boolean>).free, true);
  });

  it("une REQUÊTE n'est jamais retenue : chaque appel d'action passe par le verrou", async () => {
    const spy = spyLock();
    getRealtimeHub().setFrameAuthorizer(spy.lock);
    const { rt } = await connect();
    rt.call("act", 1);
    rt.call("act", 2);
    rt.call("act", 3);
    assert.equal(spy.count("act"), 3);
  });

  it("une action qui porte le nom d'un canal entrant n'hérite pas de son admission", async () => {
    // Poussé et autorisé, le canal `dup` n'est pas retenu : c'est aussi une action…
    const open = spyLock();
    getRealtimeHub().setFrameAuthorizer(open.lock);
    const { rt, sent } = await connect();
    rt.push("dup");
    rt.push("dup");
    assert.equal(open.count("dup"), 2, "un nom d'action ne se retient pas");
    assert.equal(rt.received.dup, 2);
    // …donc la requête du même nom passe par le verrou, qui peut la refuser.
    const deny = spyLock((m) => m !== "dup");
    getRealtimeHub().setFrameAuthorizer(deny.lock);
    rt.call("dup", 7);
    assert.equal(deny.count("dup"), 1);
    const reply = sent.find((f) => f.id === 7);
    assert.ok(reply !== undefined && "error" in reply, "requête refusée");
  });
});

// ── Méthodes du protocole ──────────────────────────────────────────────────

describe("#622 lot 4 — méthodes du protocole", () => {
  beforeEach(() => {
    getRealtimeHub().clear();
    GateRt.extraInbound = [];
  });

  it("`ping` et `unsubscribe` passent sans le verrou, même quand il refuse tout", async () => {
    const spy = spyLock(() => false);
    getRealtimeHub().setFrameAuthorizer(spy.lock);
    const { rt, sent } = await connect();
    rt.push("ping");
    rt.unsubscribe("chat");
    assert.equal(spy.count("ping"), 0);
    assert.equal(spy.count("unsubscribe"), 0);
    assert.deepEqual(denials(sent), []);
  });

  it("une REQUÊTE `ping` (une action de ce nom) passe par le verrou — le raccourci ne vaut que pour la notification", async () => {
    const spy = spyLock((m) => m !== "ping");
    getRealtimeHub().setFrameAuthorizer(spy.lock);
    const { rt, sent } = await connect();
    rt.call("ping", 9);
    assert.equal(spy.count("ping"), 1);
    const reply = sent.find((f) => f.id === 9);
    assert.ok(reply !== undefined && "error" in reply, "requête refusée");
  });

  it("`subscribe` passe par le verrou à CHAQUE trame — un canal entrant qui porte ce nom n'y change rien", async () => {
    GateRt.extraInbound = ["subscribe", "api.request"];
    const spy = spyLock();
    getRealtimeHub().setFrameAuthorizer(spy.lock);
    const { rt } = await connect();
    rt.subscribe("chat");
    rt.subscribe("free");
    rt.subscribe("tick");
    assert.equal(spy.count("subscribe"), 3);
    rt.push("api.request");
    rt.push("api.request");
    assert.equal(spy.count("api.request"), 2);
  });

  it("un canal à allow NOMMÉ comme une méthode du protocole n'est jamais admis d'office", async () => {
    // Admis, `subscribe` ferait passer TOUT abonnement sans le verrou.
    GateRt.extraInbound = ["subscribe"];
    getRealtimeHub().registerChannelPolicy("subscribe", { allow: () => true });
    const spy = spyLock();
    getRealtimeHub().setFrameAuthorizer(spy.lock);
    const { rt } = await connect();
    rt.subscribe("subscribe");
    await settle();
    rt.subscribe("chat");
    rt.subscribe("free");
    assert.equal(spy.count("subscribe"), 3);
  });

  const INHERITED = ["__proto__", "constructor", "toString", "hasOwnProperty"];

  it("un nom hérité du prototype de la table entrante est refusé avant la distribution, sans lever", async () => {
    const { rt, sent } = await connect();
    for (const name of INHERITED) {
      assert.doesNotThrow(() => rt.push(name), name);
    }
    assert.deepEqual(rt.received, {});
    assert.deepEqual(
      denials(sent).map((d) => d.channel),
      INHERITED,
    );
  });

  it("un canal à allow qui porte un nom hérité n'est jamais admis d'office", async () => {
    // Admis, `hasOwnProperty` sauterait le verrou ET le refus du prototype :
    // la distribution l'appellerait sans receveur, hors de tout `try`.
    getRealtimeHub().registerChannelPolicy("*", { allow: () => true });
    const { rt, sent } = await connect();
    rt.subscribe("hasOwnProperty");
    await settle();
    assert.doesNotThrow(() => rt.push("hasOwnProperty"));
    assert.deepEqual(
      denials(sent).map((d) => d.channel),
      ["hasOwnProperty"],
    );
  });
});

// ── Verrou et sonde défaillants ───────────────────────────────────────────

describe("#622 lot 4 — un verrou ou une sonde qui lève", () => {
  beforeEach(() => {
    getRealtimeHub().clear();
    GateRt.extraInbound = [];
  });

  it("une sonde du welcome qui lève échoue OUVERT : le canal est annoncé, la poignée de main tient", async () => {
    getRealtimeHub().setFrameAuthorizer(spyLock().lock, {
      silentProbe: () => {
        throw new Error("sonde en panne");
      },
    });
    const { sent } = await connect();
    const welcome = sent.find((f) => f.method === "realtime:welcome");
    assert.ok(welcome !== undefined, "la poignée de main a abouti");
    assert.deepEqual((welcome.params as { channels: string[] }).channels, [
      "tick",
    ]);
  });
});

// ── Canaux à allow ─────────────────────────────────────────────────────────

describe("#622 lot 4 — canal entrant à allow", () => {
  beforeEach(() => {
    getRealtimeHub().clear();
    GateRt.extraInbound = [];
    getRealtimeHub().registerChannelPolicy("room:*", {
      allow: (channel) => channel === "room:1",
    });
    getRealtimeHub().registerChannelPolicy("nowhere:*", { allow: () => true });
  });

  it("sans abonnement admis, la trame est refusée — sans même consulter le verrou", async () => {
    const spy = spyLock();
    getRealtimeHub().setFrameAuthorizer(spy.lock);
    const { rt, sent } = await connect("development");
    rt.push("room:1");
    assert.equal(spy.count("room:1"), 0);
    assert.equal(rt.received["room:1"], undefined);
    const [denied] = denials(sent);
    assert.equal(denied?.channel, "room:1");
    assert.equal(denied?.reason, "forbidden");
    assert.match(String(denied?.detail), /abonne-toi d'abord/);
  });

  it("en production, le refus ne dit rien de plus que son motif", async () => {
    const { rt, sent } = await connect("production");
    rt.push("room:1");
    const [denied] = denials(sent);
    assert.equal(denied?.reason, "forbidden");
    assert.equal(denied?.detail, undefined);
  });

  it("abonné et admis par sa règle : les trames passent sans le verrou", async () => {
    const spy = spyLock();
    getRealtimeHub().setFrameAuthorizer(spy.lock);
    const { rt } = await connect();
    rt.subscribe("room:1");
    await settle();
    for (let i = 0; i < 3; i++) rt.push("room:1");
    assert.equal(spy.count("room:1"), 0);
    assert.equal(rt.received["room:1"], 3);
  });

  it("refusé par sa règle : l'abonnement échoue et la trame reste refusée", async () => {
    GateRt.extraInbound = ["room:2"];
    const { rt, sent } = await connect();
    rt.subscribe("room:2");
    await settle();
    rt.push("room:2");
    assert.equal(rt.received["room:2"], undefined);
    assert.deepEqual(
      denials(sent).map((d) => d.channel),
      ["room:2", "room:2"],
    );
  });

  it("admis par sa règle mais SANS producteur : rien n'est admis", async () => {
    const { rt } = await connect();
    rt.subscribe("nowhere:1");
    await settle();
    rt.push("nowhere:1");
    assert.equal(rt.received["nowhere:1"], undefined);
  });

  it("désabonné : l'admission tombe avec l'abonnement", async () => {
    const { rt, ctx } = await connect();
    rt.subscribe("room:1");
    await settle();
    rt.push("room:1");
    rt.unsubscribe("room:1");
    rt.push("room:1");
    assert.equal(rt.received["room:1"], 1);
    // Retirée par `false`, jamais par `delete` : la forme de la table ne bouge pas.
    const state = stateOf(ctx);
    assert.deepEqual(
      Object.keys(state.admitted ?? {}),
      Object.keys(state.inbound),
    );
  });

  it("un verrou posé après coup n'oublie PAS une admission par allow — elle vaut autant que l'abonnement, qui reste servi", async () => {
    const { rt } = await connect();
    rt.subscribe("room:1");
    await settle();
    const spy = spyLock(() => false);
    getRealtimeHub().setFrameAuthorizer(spy.lock);
    rt.push("room:1");
    assert.equal(rt.received["room:1"], 1);
    assert.equal(spy.count("room:1"), 0);
  });
});

// ── Ce qui fait oublier ────────────────────────────────────────────────────

describe("#622 lot 4 — ce qui fait oublier les verdicts retenus", () => {
  beforeEach(() => {
    getRealtimeHub().clear();
    GateRt.extraInbound = [];
  });

  it("une politique inscrite après coup : le verrou est consulté de nouveau, une fois", async () => {
    const spy = spyLock();
    getRealtimeHub().setFrameAuthorizer(spy.lock);
    const { rt } = await connect();
    rt.push("chat");
    rt.push("chat");
    getRealtimeHub().registerChannelPolicy("chat", { roles: ["ROLE_ADMIN"] });
    rt.push("chat");
    rt.push("chat");
    assert.equal(spy.count("chat"), 2);
  });

  it("l'oubli garde la forme de la table des admis : les clés restent, à false", async () => {
    getRealtimeHub().setFrameAuthorizer(spyLock().lock);
    const { rt, ctx } = await connect();
    rt.push("chat");
    getRealtimeHub().registerChannelPolicy("x", { authenticated: true });
    const state = stateOf(ctx);
    assert.deepEqual(
      Object.keys(state.admitted ?? {}),
      Object.keys(state.inbound),
    );
    assert.equal(state.admitted?.chat, false);
  });

  it("un motif inscrit après coup fait oublier aussi", async () => {
    const spy = spyLock();
    getRealtimeHub().setFrameAuthorizer(spy.lock);
    const { rt } = await connect();
    rt.push("chat");
    getRealtimeHub().registerChannelPolicy("ch*", { authenticated: true });
    rt.push("chat");
    assert.equal(spy.count("chat"), 2);
  });

  it("un verdict retenu survit au désabonnement : il ne tient qu'à l'identité", async () => {
    const spy = spyLock();
    getRealtimeHub().setFrameAuthorizer(spy.lock);
    const { rt } = await connect();
    rt.subscribe("chat");
    rt.push("chat");
    rt.unsubscribe("chat");
    rt.push("chat");
    assert.equal(spy.count("chat"), 1);
    assert.equal(rt.received.chat, 2);
  });

  it("le hub vidé (`clear`) fait oublier — la connexion se réinscrit à sa prochaine retenue", async () => {
    const hub = getRealtimeHub();
    const { rt } = await connect();
    rt.push("chat");
    hub.clear();
    const track = vi.spyOn(hub, "trackRetainedVerdicts");
    rt.push("chat");
    assert.equal(track.mock.calls.length, 1, "le verdict a été oublié");
    assert.equal(rt.received.chat, 2);
    track.mockRestore();
  });

  it("à la fermeture, la connexion sort du registre des verdicts retenus — par le hub qui l'y a inscrite", async () => {
    const hub = getRealtimeHub();
    const track = vi.spyOn(hub, "trackRetainedVerdicts");
    const untrack = vi.spyOn(hub, "untrackRetainedVerdicts");
    const { rt, fireFinish } = await connect();
    rt.push("chat");
    rt.push("free");
    assert.equal(track.mock.calls.length, 1, "inscrite à sa PREMIÈRE retenue");
    const [state] = track.mock.calls[0] ?? [];
    fireFinish();
    assert.equal(untrack.mock.calls.length, 1);
    assert.equal(untrack.mock.calls[0]?.[0], state);
    track.mockRestore();
    untrack.mockRestore();
  });

  it("une connexion dont les verdicts ont été oubliés sort AUSSI du registre à sa fermeture", async () => {
    const hub = getRealtimeHub();
    const untrack = vi.spyOn(hub, "untrackRetainedVerdicts");
    const { rt, fireFinish } = await connect();
    rt.push("chat");
    hub.setFrameAuthorizer(spyLock().lock);
    fireFinish();
    assert.equal(untrack.mock.calls.length, 1);
    untrack.mockRestore();
  });

  it("après un oubli, la connexion se réinscrit à sa prochaine retenue", async () => {
    const hub = getRealtimeHub();
    const track = vi.spyOn(hub, "trackRetainedVerdicts");
    const { rt } = await connect();
    rt.push("chat");
    hub.setFrameAuthorizer(spyLock().lock);
    rt.push("chat");
    assert.equal(track.mock.calls.length, 2);
    track.mockRestore();
  });
});
