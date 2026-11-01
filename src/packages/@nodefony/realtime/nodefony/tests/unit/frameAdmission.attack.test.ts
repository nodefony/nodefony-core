import assert from "node:assert/strict";
import { beforeEach, describe, it } from "vitest";
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
 * #622 — red-team du verrou des trames (ADR-0022 §6, décision 1 ter).
 *
 * Menace : un droit RETENU (verdict du verrou, admission par `allow`) ne doit
 * jamais ÉLARGIR un accès : ni à un autre nom, ni à un autre type de trame, ni
 * après l'événement qui l'a invalidé, ni d'une connexion à l'autre.
 */

// ── Décor (copié de frameAdmission.test.ts) ────────────────────────────────

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
    outboundTracer: () => null,
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

const INBOUND = ["chat", "free", "room:1", "room:10", "dup", "café"];

class AtkRt extends RealtimeController {
  static extraInbound: string[] = [];
  received: Record<string, number> = {};
  constructor(ctx: unknown) {
    super("atk-rt", ctx as ContextType);
  }
  override realtimeInbound(): Record<string, RealtimeInboundHandler> {
    const handlers: Record<string, RealtimeInboundHandler> = {};
    for (const name of [...INBOUND, ...AtkRt.extraInbound]) {
      handlers[name] = () => {
        this.received[name] = (this.received[name] ?? 0) + 1;
      };
    }
    return handlers;
  }
  actionRuns = 0;
  override realtimeActions(): Record<string, RpcActionHandler> {
    return {
      dup: () => "action",
      act: () => {
        this.actionRuns++;
        return "action";
      },
      ping: () => "pong",
    };
  }
  override createRealtimeChannel(
    _channel: string,
    _publish: RealtimePublish,
  ): (() => void) | null {
    return () => {};
  }
  boot(): void {
    this.handleRealtime(null);
  }
  raw(text: string): void {
    this.handleRealtime(text);
  }
  feed(frame: object): void {
    this.raw(JSON.stringify({ jsonrpc: "2.0", ...frame }));
  }
  push(method: string, params: unknown = { n: 1 }): void {
    this.feed({ method, params });
  }
  call(method: string, id: unknown): void {
    this.feed({ id, method, params: {} });
  }
  subscribe(channel: unknown): void {
    this.feed({ method: "subscribe", params: { channel } });
  }
  unsubscribe(channel: unknown): void {
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

function spyLock(
  verdict: (method: string, frame: Record<string, unknown>) => boolean = () =>
    true,
) {
  const calls: Record<string, number> = Object.create(null);
  const lock: FrameAuthorizer = (frame) => {
    const f = frame as Record<string, unknown>;
    const method = String(f.method);
    calls[method] = (calls[method] ?? 0) + 1;
    return verdict(method, f);
  };
  return { lock, calls, count: (m: string) => calls[m] ?? 0 };
}

async function connect() {
  getRealtimeHub().useAuthenticator(
    { pattern: "/realtime" },
    { name: "fixe", supports: () => true, authenticate: async () => token },
  );
  const h = makeCtx();
  const rt = new AtkRt(h.ctx);
  rt.boot();
  await new Promise<void>((resolve) => setImmediate(resolve));
  return { ...h, rt };
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
const denied = (sent: Array<Record<string, unknown>>) =>
  sent
    .filter((f) => f.method === "realtime:denied")
    .map((f) => (f.params as Record<string, unknown>).channel);

/** Promesse résolue à la main : fige l'ordre des courses. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Règle `allow` pilotable, posée sur `room:*`. */
function roomPolicy(
  impl: (channel: string) => boolean | Promise<boolean>,
): void {
  getRealtimeHub().registerChannelPolicy("room:*", { allow: impl });
}

beforeEach(() => {
  getRealtimeHub().clear();
  AtkRt.extraInbound = [];
});

// ── A. Collisions de noms et de types de trame ─────────────────────────────

describe("#622 red-team A — un verdict retenu ne vaut que pour SON nom exact et SON type", () => {
  it("variantes Unicode, casse, espaces et NUL d'un canal retenu : jamais servies sans le verrou", async () => {
    const spy = spyLock();
    getRealtimeHub().setFrameAuthorizer(spy.lock);
    const { rt } = await connect();
    rt.push("chat");
    assert.equal(rt.received.chat, 1);
    const variants = [
      "Chat",
      "CHAT",
      "chat ",
      " chat",
      "chat\u0000",
      "chat\n",
      "ｃｈａｔ", // pleine chasse
      "chаt", // « а » cyrillique
      "chat​", // espace de largeur nulle
    ];
    for (const v of variants) rt.push(v);
    assert.equal(rt.received.chat, 1, "aucun variant n'atteint le handler");
    for (const v of variants) {
      assert.equal(rt.received[v], undefined, JSON.stringify(v));
    }
  });

  it("NFC vs NFD : « café » retenu en NFC ne couvre pas la forme décomposée", async () => {
    const spy = spyLock();
    getRealtimeHub().setFrameAuthorizer(spy.lock);
    const { rt } = await connect();
    const nfd = "café".normalize("NFD");
    assert.notEqual(nfd, "café");
    rt.push("café");
    rt.push(nfd);
    assert.equal(rt.received["café"], 1);
    assert.equal(rt.received[nfd], undefined);
  });

  it("méthode non chaîne (tableau, nombre, objet, null, booléen) : jamais une clé de la table des admis", async () => {
    const spy = spyLock();
    getRealtimeHub().setFrameAuthorizer(spy.lock);
    const { rt } = await connect();
    rt.push("chat"); // retenu
    for (const method of [["chat"], 1, { toString: "chat" }, null, true]) {
      assert.doesNotThrow(() => rt.feed({ method, params: {} }));
    }
    assert.equal(rt.received.chat, 1, "chat servi une seule fois");
  });

  it('méthode tableau ["subscribe"] : ne saute pas le verrou par coercition de clé', async () => {
    AtkRt.extraInbound = ["subscribe"];
    const spy = spyLock((m) => m !== "subscribe");
    getRealtimeHub().setFrameAuthorizer(spy.lock);
    const { rt } = await connect();
    rt.feed({ method: ["subscribe"], params: { channel: "chat" } });
    rt.feed({ method: ["api.request"], params: {} });
    assert.equal(rt.received.subscribe, undefined);
  });

  it("une REQUÊTE (id présent) portant le nom d'un canal retenu n'exécute pas le handler entrant", async () => {
    const spy = spyLock();
    getRealtimeHub().setFrameAuthorizer(spy.lock);
    const { rt } = await connect();
    rt.push("chat");
    // ids « faux » : 0, chaîne vide — une garde `if (frame.id)` les verrait comme notifications.
    for (const id of [0, "", "0", 1, null]) rt.call("chat", id);
    assert.equal(rt.received.chat, 1);
  });

  it('une action à id FALSY (0, "") passe par le verrou comme n\'importe quelle requête', async () => {
    const spy = spyLock((m) => m !== "act");
    getRealtimeHub().setFrameAuthorizer(spy.lock);
    const { rt } = await connect();
    rt.call("act", 0);
    rt.call("act", "");
    rt.call("act", 3);
    assert.equal(rt.actionRuns, 0, "l'action n'a jamais tourné");
  });

  it("un `ping` à id falsy (requête) ne prend pas le raccourci des notifications", async () => {
    const spy = spyLock(() => false);
    getRealtimeHub().setFrameAuthorizer(spy.lock);
    const { rt, sent } = await connect();
    rt.call("ping", 0);
    rt.call("ping", "");
    assert.equal(spy.count("ping"), 2);
    assert.equal(sent.filter((f) => "result" in f).length, 0, "aucun pong");
  });

  it("un `unsubscribe` à id (requête) passe par le verrou", async () => {
    const spy = spyLock(() => false);
    getRealtimeHub().setFrameAuthorizer(spy.lock);
    const { rt } = await connect();
    rt.call("unsubscribe", 5);
    assert.equal(spy.count("unsubscribe"), 1);
  });

  it("lot JSON-RPC (tableau) : aucune entrée du lot ne contourne le verrou ni ne profite d'un verdict retenu", async () => {
    const spy = spyLock((m) => m !== "act" && m !== "free");
    getRealtimeHub().setFrameAuthorizer(spy.lock);
    const { rt } = await connect();
    rt.push("chat"); // retenu
    rt.raw(
      JSON.stringify([
        { jsonrpc: "2.0", method: "chat", params: {} },
        { jsonrpc: "2.0", method: "free", params: {} },
        { jsonrpc: "2.0", id: 1, method: "act", params: {} },
        {
          jsonrpc: "2.0",
          id: 2,
          method: "subscribe",
          params: { channel: "x" },
        },
      ]),
    );
    assert.equal(rt.actionRuns, 0);
    assert.equal(rt.received.free, undefined);
  });

  it("trames malformées : aucune ne lève, aucune n'atteint un handler", async () => {
    const spy = spyLock();
    getRealtimeHub().setFrameAuthorizer(spy.lock);
    const { rt } = await connect();
    rt.push("chat");
    for (const raw of [
      "",
      "{",
      "null",
      "[]",
      "42",
      '"chat"',
      "{}",
      '{"method":"chat"}',
      '{"jsonrpc":"1.0","method":"free"}',
      '{"jsonrpc":"2.0","method":"free","params":null}',
    ]) {
      assert.doesNotThrow(() => rt.raw(raw), raw);
    }
    assert.equal(rt.received.chat, 1);
  });

  it("une admission d'un nom ne déborde pas sur un nom qui le préfixe (`room:1` / `room:10`)", async () => {
    roomPolicy((c) => c === "room:1");
    const { rt } = await connect();
    rt.subscribe("room:1");
    await settle();
    rt.push("room:10");
    assert.equal(rt.received["room:10"], undefined);
    rt.push("room:1");
    assert.equal(rt.received["room:1"], 1);
  });
});

// ── B. Subscribe : formes, ordre, course ───────────────────────────────────

describe("#622 red-team B — l'admission ne naît que d'un subscribe réellement admis, et meurt avec lui", () => {
  it("verrou qui REFUSE `subscribe` : même si `allow` dirait oui, la trame suivante reste refusée", async () => {
    roomPolicy(() => true);
    getRealtimeHub().setFrameAuthorizer(spyLock((m) => m !== "subscribe").lock);
    const { rt } = await connect();
    rt.subscribe("room:1");
    await settle();
    rt.push("room:1");
    assert.equal(rt.received["room:1"], undefined);
  });

  it("trame envoyée AVANT que `allow` asynchrone ait répondu : refusée", async () => {
    const gate = deferred<boolean>();
    roomPolicy(() => gate.promise);
    const { rt, sent } = await connect();
    rt.subscribe("room:1");
    rt.push("room:1");
    assert.equal(rt.received["room:1"], undefined);
    assert.ok(denied(sent).includes("room:1"));
    gate.resolve(true);
    await settle();
    rt.push("room:1");
    assert.equal(rt.received["room:1"], 1);
  });

  it("unsubscribe PENDANT l'`allow` asynchrone : la résolution tardive ne ressuscite pas l'admission", async () => {
    const gate = deferred<boolean>();
    roomPolicy(() => gate.promise);
    const { rt } = await connect();
    rt.subscribe("room:1");
    rt.unsubscribe("room:1");
    gate.resolve(true);
    await settle();
    await settle();
    rt.push("room:1");
    assert.equal(rt.received["room:1"], undefined, "admission fantôme");
  });

  it("fermeture PENDANT l'`allow` asynchrone : rien n'est écrit ni émis sur la connexion morte", async () => {
    const gate = deferred<boolean>();
    roomPolicy(() => gate.promise);
    const { rt, sent, fireFinish } = await connect();
    rt.subscribe("room:1");
    fireFinish();
    const before = sent.length;
    gate.resolve(true);
    await settle();
    await settle();
    assert.doesNotThrow(() => rt.push("room:1"));
    assert.equal(rt.received["room:1"], undefined);
    assert.equal(
      sent.filter((f) => f.method === "realtime:denied").length,
      sent.slice(0, before).filter((f) => f.method === "realtime:denied")
        .length +
        sent.slice(before).filter((f) => f.method === "realtime:denied").length,
    );
  });

  it("subscribe / unsubscribe / subscribe pendant l'allow : la demande est RANIMÉE (une seule évaluation), l'admission suit l'abonnement réel", async () => {
    const slow = deferred<boolean>();
    let calls = 0;
    roomPolicy(() => {
      calls++;
      return slow.promise;
    });
    const { rt } = await connect();
    rt.subscribe("room:1");
    rt.unsubscribe("room:1");
    rt.push("room:1"); // ni abonné ni admis
    assert.equal(rt.received["room:1"], undefined);
    rt.subscribe("room:1"); // ranime la demande en vol
    slow.resolve(true);
    await settle();
    await settle();
    assert.equal(calls, 1, "une seule évaluation : règle de conception");
    rt.push("room:1");
    assert.equal(rt.received["room:1"], 1);
    rt.unsubscribe("room:1");
    rt.push("room:1");
    assert.equal(
      rt.received["room:1"],
      1,
      "l'admission tombe avec l'abonnement",
    );
  });

  it("`allow` qui lève (sync), rejette (async) ou rend un non-booléen truthy : jamais admis", async () => {
    const outcomes: Array<() => unknown> = [
      () => {
        throw new Error("boom");
      },
      () => Promise.reject(new Error("boom")),
      () => "false",
      () => 1,
      () => ({}),
      () => undefined,
      () => null,
      () => Promise.resolve("true"),
    ];
    for (const impl of outcomes) {
      getRealtimeHub().clear();
      roomPolicy(impl as unknown as () => boolean);
      const { rt } = await connect();
      assert.doesNotThrow(() => rt.subscribe("room:1"));
      await settle();
      await settle();
      rt.push("room:1");
      assert.equal(rt.received["room:1"], undefined, String(impl));
    }
  });

  it("forme du paramètre `channel` : tableau, nombre, objet, null, absent — rien n'est admis par coercition", async () => {
    roomPolicy(() => true);
    const { rt } = await connect();
    for (const channel of [
      ["room:1"],
      1,
      { toString: "room:1" },
      null,
      undefined,
    ]) {
      assert.doesNotThrow(() => rt.subscribe(channel));
    }
    rt.feed({ method: "subscribe" });
    rt.feed({ method: "subscribe", params: ["room:1"] });
    rt.feed({ method: "subscribe", params: "room:1" });
    await settle();
    rt.push("room:1");
    assert.equal(rt.received["room:1"], undefined);
  });

  it("subscribe sous une variante du nom (casse, espace, NFD) : n'admet pas le canal exact", async () => {
    roomPolicy(() => true);
    AtkRt.extraInbound = ["Room:1"];
    const { rt } = await connect();
    for (const v of [
      "ROOM:1",
      "room:1 ",
      " room:1",
      "room:1\u0000",
      "room：1",
    ]) {
      rt.subscribe(v);
    }
    await settle();
    rt.push("room:1");
    assert.equal(rt.received["room:1"], undefined);
  });

  it("noms hérités du prototype en subscribe/unsubscribe : ni pollution, ni admission d'office", async () => {
    getRealtimeHub().registerChannelPolicy("*", { allow: () => true });
    const { rt } = await connect();
    for (const name of [
      "__proto__",
      "constructor",
      "toString",
      "hasOwnProperty",
    ]) {
      rt.subscribe(name);
      rt.unsubscribe(name);
      rt.subscribe(name);
    }
    await settle();
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
    assert.equal(Object.getPrototypeOf({}), Object.prototype);
    for (const name of [
      "__proto__",
      "constructor",
      "toString",
      "hasOwnProperty",
    ]) {
      assert.doesNotThrow(() => rt.push(name), name);
    }
    assert.deepEqual(rt.received, {});
  });

  it("admission d'une connexion : jamais visible depuis une AUTRE connexion du même contrôleur", async () => {
    roomPolicy(() => true);
    const a = await connect();
    const b = await connect();
    a.rt.subscribe("room:1");
    await settle();
    b.rt.push("room:1");
    assert.equal(b.rt.received["room:1"], undefined);
    assert.ok(denied(b.sent).includes("room:1"));
    a.rt.push("room:1");
    assert.equal(a.rt.received["room:1"], 1);
  });

  it("désabonner un AUTRE canal (ou un canal inconnu) ne touche pas l'admission en cours — et l'inverse n'élargit rien", async () => {
    roomPolicy(() => true);
    AtkRt.extraInbound = ["room:2"];
    const { rt } = await connect();
    rt.subscribe("room:1");
    await settle();
    rt.unsubscribe("room:2");
    rt.unsubscribe("inconnu");
    rt.push("room:1");
    rt.push("room:2"); // jamais abonné
    assert.equal(rt.received["room:1"], 1);
    assert.equal(rt.received["room:2"], undefined);
  });

  it("`allow` repassé à FAUX puis re-subscribe refusé : le refus ne laisse pas une admission neuve", async () => {
    let ok = true;
    roomPolicy(() => ok);
    const { rt } = await connect();
    rt.subscribe("room:1");
    await settle();
    rt.unsubscribe("room:1");
    ok = false;
    rt.subscribe("room:1");
    await settle();
    rt.push("room:1");
    assert.equal(rt.received["room:1"], undefined);
  });

  it("le canal à `allow` est jugé par `allow` : un verdict retenu AVANT l'inscription de la règle est oublié", async () => {
    getRealtimeHub().setFrameAuthorizer(spyLock().lock);
    const { rt } = await connect();
    rt.push("chat"); // retenu, canal libre
    getRealtimeHub().registerChannelPolicy("chat", { allow: () => false });
    rt.push("chat");
    assert.equal(rt.received.chat, 1, "le second push est refusé");
  });
});

// ── C. Le verrou lui-même : verdicts non booléens, évolutions ──────────────

describe("#622 red-team C — fail-closed sur le verdict du verrou et sur ses évolutions", () => {
  it("verrou qui rend une PROMESSE (contrat sync violé) : jamais lue comme un oui", async () => {
    const lock = (() => Promise.resolve(false)) as unknown as FrameAuthorizer;
    getRealtimeHub().setFrameAuthorizer(lock);
    const { rt } = await connect();
    rt.push("chat");
    rt.call("act", 1);
    assert.equal(rt.received.chat, undefined, "promesse truthy = bypass");
    assert.equal(rt.actionRuns, 0);
  });

  it('verrou qui rend un truthy non booléen (1, "no", {}) : refusé', async () => {
    for (const verdict of [1, "no", {}, []]) {
      getRealtimeHub().clear();
      getRealtimeHub().setFrameAuthorizer(
        (() => verdict) as unknown as FrameAuthorizer,
      );
      const { rt } = await connect();
      rt.push("chat");
      rt.call("act", 1);
      assert.equal(rt.received.chat, undefined, JSON.stringify(verdict));
      assert.equal(rt.actionRuns, 0, JSON.stringify(verdict));
    }
  });

  it("verrou qui LÈVE : trame refusée, rien de retenu, la connexion survit", async () => {
    let throwing = true;
    getRealtimeHub().setFrameAuthorizer(() => {
      if (throwing) throw new Error("lock down");
      return true;
    });
    const { rt } = await connect();
    assert.doesNotThrow(() => rt.push("chat"));
    assert.equal(rt.received.chat, undefined);
    throwing = false;
    rt.push("chat");
    assert.equal(rt.received.chat, 1);
  });

  it("verrou remplacé par un verrou qui refuse tout : tous les canaux retenus sont reconsultés", async () => {
    getRealtimeHub().setFrameAuthorizer(spyLock().lock);
    const { rt } = await connect();
    rt.push("chat");
    rt.push("free");
    getRealtimeHub().setFrameAuthorizer(spyLock(() => false).lock);
    rt.push("chat");
    rt.push("free");
    assert.equal(rt.received.chat, 1);
    assert.equal(rt.received.free, 1);
  });

  it("verrou RETIRÉ (null/undefined) puis reposé refusant : aucun verdict d'avant ne survit", async () => {
    getRealtimeHub().setFrameAuthorizer(spyLock().lock);
    const { rt } = await connect();
    rt.push("chat");
    getRealtimeHub().setFrameAuthorizer(null as unknown as FrameAuthorizer);
    getRealtimeHub().setFrameAuthorizer(spyLock(() => false).lock);
    rt.push("chat");
    assert.equal(rt.received.chat, 1);
  });

  it("politique inscrite après coup sur un canal retenu : elle s'applique à la trame suivante, y compris pour un MOTIF", async () => {
    const spy = spyLock(
      (_m, f) => f.method !== "chat" || spy.count("chat") === 1,
    );
    getRealtimeHub().setFrameAuthorizer(spy.lock);
    const { rt } = await connect();
    rt.push("chat");
    getRealtimeHub().registerChannelPolicy("c*", { roles: ["ROLE_ADMIN"] });
    rt.push("chat");
    assert.equal(
      spy.count("chat"),
      2,
      "reconsulté après la nouvelle politique",
    );
    assert.equal(rt.received.chat, 1, "et refusé");
  });

  it("la retenue est liée au NOM, pas aux paramètres : une trame aux paramètres hostiles est tout de même servie (limite documentée)", async () => {
    // Le verrou juge la cible (canal), pas la charge : c'est le contrat de l'ADR.
    // Ce test fixe la limite pour qu'un changement de contrat soit voulu.
    const spy = spyLock((_m, f) => {
      const p = f.params as { admin?: boolean } | undefined;
      return p?.admin !== true;
    });
    getRealtimeHub().setFrameAuthorizer(spy.lock);
    const { rt } = await connect();
    rt.push("chat", { admin: false });
    rt.push("chat", { admin: true });
    assert.equal(spy.count("chat"), 1);
    assert.equal(rt.received.chat, 2);
  });

  it("un refus n'épuise pas le plafond : après 100 refus, les canaux autorisés se retiennent encore", async () => {
    const extra = Array.from({ length: 100 }, (_, i) => `d:${i}`);
    AtkRt.extraInbound = [...extra, "ok:1"];
    let allowAll = false;
    const spy = spyLock(() => allowAll);
    getRealtimeHub().setFrameAuthorizer(spy.lock);
    const { rt } = await connect();
    for (const n of extra) rt.push(n);
    allowAll = true;
    rt.push("ok:1");
    rt.push("ok:1");
    assert.equal(spy.count("ok:1"), 1);
    assert.equal(rt.received["ok:1"], 2);
  });

  it("plafond atteint : un canal sensible hors plafond reste jugé à chaque trame, et un verrou durci le refuse aussitôt", async () => {
    const extra = Array.from(
      { length: MAX_RETAINED_FRAME_VERDICTS },
      (_, i) => `fill:${i}`,
    );
    AtkRt.extraInbound = extra;
    const spy = spyLock();
    getRealtimeHub().setFrameAuthorizer(spy.lock);
    const { rt } = await connect();
    for (const n of extra) rt.push(n);
    rt.push("chat"); // 65e : non retenu
    getRealtimeHub().setFrameAuthorizer(spyLock((m) => m !== "chat").lock);
    rt.push("chat");
    assert.equal(rt.received.chat, 1);
  });

  it("après oubli, le plafond est REMIS à zéro (les 64 places reviennent)", async () => {
    const extra = Array.from(
      { length: MAX_RETAINED_FRAME_VERDICTS },
      (_, i) => `fill:${i}`,
    );
    AtkRt.extraInbound = extra;
    getRealtimeHub().setFrameAuthorizer(spyLock().lock);
    const { rt } = await connect();
    for (const n of extra) rt.push(n);
    const spy = spyLock();
    getRealtimeHub().setFrameAuthorizer(spy.lock);
    for (const n of extra) rt.push(n);
    for (const n of extra) rt.push(n);
    assert.equal(
      extra.filter((n) => spy.count(n) === 1).length,
      MAX_RETAINED_FRAME_VERDICTS,
    );
  });
});

// ── D. Admission par allow et verrou : interactions ────────────────────────

describe("#622 red-team D — admission par allow : portée exacte", () => {
  it("l'admission par allow ne vaut que pour ses trames de CANAL : `act` (requête) et `subscribe` restent au verrou", async () => {
    roomPolicy(() => true);
    const spy = spyLock((m) => m !== "act");
    getRealtimeHub().setFrameAuthorizer(spy.lock);
    const { rt } = await connect();
    rt.subscribe("room:1");
    await settle();
    rt.call("act", 1);
    rt.push("room:1");
    assert.equal(rt.actionRuns, 0);
    assert.equal(spy.count("act"), 1);
    assert.equal(spy.count("subscribe"), 1);
  });

  it("une action nommée comme un canal admis par allow : la REQUÊTE passe par le verrou", async () => {
    getRealtimeHub().registerChannelPolicy("dup", { allow: () => true });
    const spy = spyLock((m) => m !== "dup");
    getRealtimeHub().setFrameAuthorizer(spy.lock);
    const { rt, sent } = await connect();
    rt.subscribe("dup");
    await settle();
    rt.call("dup", 4);
    const reply = sent.find((f) => f.id === 4);
    assert.ok(reply !== undefined && "error" in reply, "requête refusée");
  });

  it("canal à allow : un verdict du verrou, même positif, ne remplace pas l'abonnement admis", async () => {
    roomPolicy((c) => c === "room:1");
    getRealtimeHub().setFrameAuthorizer(spyLock().lock);
    const { rt } = await connect();
    rt.subscribe("room:10"); // refusé par allow
    await settle();
    rt.push("room:10");
    rt.push("room:10");
    assert.equal(rt.received["room:10"], undefined);
  });

  it("règle `allow` inscrite APRÈS un verdict retenu sur ce nom : bascule immédiate vers l'exigence d'abonnement", async () => {
    getRealtimeHub().setFrameAuthorizer(spyLock().lock);
    const { rt } = await connect();
    rt.push("room:1");
    assert.equal(rt.received["room:1"], 1);
    roomPolicy(() => true);
    rt.push("room:1");
    assert.equal(rt.received["room:1"], 1, "abonne-toi d'abord");
  });

  it("trames après fermeture : ne lèvent pas et n'atteignent aucun handler", async () => {
    getRealtimeHub().setFrameAuthorizer(spyLock().lock);
    const { rt, fireFinish } = await connect();
    rt.push("chat");
    fireFinish();
    assert.doesNotThrow(() => rt.push("chat"));
  });
});

// ── E. Passe 2 — contrôleur sans aucun canal entrant ───────────────────────

class NoInboundRt extends AtkRt {
  override realtimeInbound(): Record<string, RealtimeInboundHandler> {
    return {};
  }
}

describe("#622 red-team E — contrôleur sans canal entrant : le verrou juge chaque notification", () => {
  it("aucune table entrante : chaque notification est jugée, rien n'est retenu, ni lu sur un prototype", async () => {
    const spy = spyLock((m) => m !== "chat");
    getRealtimeHub().setFrameAuthorizer(spy.lock);
    getRealtimeHub().useAuthenticator(
      { pattern: "/realtime" },
      { name: "fixe", supports: () => true, authenticate: async () => token },
    );
    const h = makeCtx();
    const rt = new NoInboundRt(h.ctx);
    rt.boot();
    await settle();
    for (const name of ["chat", "chat", "toString", "__proto__"]) {
      assert.doesNotThrow(() => rt.push(name), name);
    }
    assert.equal(spy.count("chat"), 2);
    assert.equal(spy.count("toString"), 1);
    assert.deepEqual(rt.received, {});
  });
});
