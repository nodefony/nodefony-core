import { describe, it, expect, beforeEach } from "vitest";
import "reflect-metadata";
import { RealtimeController } from "../../src/server/RealtimeController.js";
import { getRealtimeHub } from "../../src/server/RealtimeHub.js";
import type { RealtimePublish } from "../../interfaces/IRealtimeController.js";
import type { ContextType } from "@nodefony/http";

/**
 * Un abonnement ACCEPTÉ s'acquitte (`realtime:subscribed`) — #610.
 *
 * Le trou fermé : le serveur ne répondait qu'aux refus. Un client ne pouvait
 * donc pas savoir QUAND son abonnement devenait actif, et tout ce qui était
 * publié entre l'ouverture de la socket et l'inscription réelle se perdait sans
 * un mot (vécu : reconnexion e2e rouge en CI, contournée en relançant le trafic
 * en boucle).
 *
 * L'acquittement et le refus s'excluent : un abonnement reçoit l'un OU l'autre.
 */

const OPEN = 1;

function makeCtx() {
  const sent: Array<Record<string, unknown>> = [];
  const conn = {
    readyState: OPEN,
    send: (data: string, cb?: (err?: Error) => void) => {
      sent.push(JSON.parse(data));
      cb?.();
    },
    close: () => {},
  };
  const ctx = {
    connection: conn,
    once: () => {},
    request: { headers: {}, url: "/" },
    cookies: {},
    url: "/",
    remoteAddress: "127.0.0.1",
    origin: "",
  };
  return { ctx, sent };
}

/** Controller qui ne produit QUE `connu:*`. */
class TestRt extends RealtimeController {
  constructor(ctx: unknown) {
    super("test-rt-ack", ctx as ContextType);
  }
  override createRealtimeChannel(channel: string, _publish: RealtimePublish) {
    return channel.startsWith("connu:") ? () => {} : null;
  }
  feed(message: string | null): void {
    this.handleRealtime(message);
  }
}

const frame = (channel: string): string =>
  JSON.stringify({ jsonrpc: "2.0", method: "subscribe", params: { channel } });

const acksFor = (sent: Array<Record<string, unknown>>): unknown[] =>
  sent.filter((f) => f.method === "realtime:subscribed").map((f) => f.params);

const deniedFor = (sent: Array<Record<string, unknown>>): unknown[] =>
  sent.filter((f) => f.method === "realtime:denied").map((f) => f.params);

describe("realtime:subscribed — l'abonnement accepté se DIT", () => {
  beforeEach(() => {
    getRealtimeHub().clear();
    getRealtimeHub().setMaxChannelsPerConnection(256);
  });

  it("le welcome ANNONCE la capacité (subscriptionAcks: true)", () => {
    const { ctx, sent } = makeCtx();
    new TestRt(ctx).feed(null);
    const welcome = sent.find((f) => f.method === "realtime:welcome");
    expect(welcome).toBeDefined();
    expect(welcome?.params).toMatchObject({ subscriptionAcks: true });
  });

  it("🔴 abonnement accepté → realtime:subscribed {channel}, et aucun refus", () => {
    const { ctx, sent } = makeCtx();
    const rt = new TestRt(ctx);
    rt.feed(null);
    rt.feed(frame("connu:a"));
    expect(acksFor(sent)).to.deep.equal([{ channel: "connu:a" }]);
    expect(deniedFor(sent)).to.have.length(0);
  });

  it("l'acquittement part APRÈS l'inscription au hub (une publication postérieure est livrée)", () => {
    const { ctx, sent } = makeCtx();
    const rt = new TestRt(ctx);
    rt.feed(null);
    rt.feed(frame("connu:a"));
    const ackIndex = sent.findIndex((f) => f.method === "realtime:subscribed");
    expect(ackIndex).toBeGreaterThanOrEqual(0);
    getRealtimeHub().publish("connu:a", { n: 1 });
    expect(sent.slice(ackIndex + 1).map((f) => f.method)).to.include("connu:a");
  });

  it("un second subscribe du MÊME canal est acquitté lui aussi (sinon l'attente ne finit pas)", () => {
    const { ctx, sent } = makeCtx();
    const rt = new TestRt(ctx);
    rt.feed(null);
    rt.feed(frame("connu:a"));
    rt.feed(frame("connu:a"));
    expect(acksFor(sent)).to.deep.equal([
      { channel: "connu:a" },
      { channel: "connu:a" },
    ]);
  });

  it("sens négatif : un canal sans producteur est refusé, JAMAIS acquitté", () => {
    const { ctx, sent } = makeCtx();
    const rt = new TestRt(ctx);
    rt.feed(null);
    rt.feed(frame("inconnu:x"));
    expect(acksFor(sent)).to.have.length(0);
    expect(deniedFor(sent)).to.have.length(1);
  });

  it("sens négatif : au plafond de canaux, refus `limit` sans acquittement", () => {
    getRealtimeHub().setMaxChannelsPerConnection(1);
    const { ctx, sent } = makeCtx();
    const rt = new TestRt(ctx);
    rt.feed(null);
    rt.feed(frame("connu:a"));
    rt.feed(frame("connu:b"));
    expect(acksFor(sent)).to.deep.equal([{ channel: "connu:a" }]);
    expect(deniedFor(sent)).toMatchObject([
      { channel: "connu:b", reason: "limit" },
    ]);
  });
});

const unsubFrame = (channel: string): string =>
  JSON.stringify({
    jsonrpc: "2.0",
    method: "unsubscribe",
    params: { channel },
  });

describe("realtime:subscribed — les bords du contrat", () => {
  beforeEach(() => {
    getRealtimeHub().clear();
    getRealtimeHub().setMaxChannelsPerConnection(256);
  });

  it("sens négatif : le plancher de plateforme (forbidden) n'est jamais acquitté", () => {
    const { ctx, sent } = makeCtx();
    const rt = new TestRt(ctx);
    rt.feed(null);
    rt.feed(frame("nodefony:syslog"));
    expect(acksFor(sent)).to.have.length(0);
    expect(deniedFor(sent)).toMatchObject([
      { channel: "nodefony:syslog", reason: "forbidden" },
    ]);
  });

  it("sens négatif : un subscribe malformé (canal absent, non-chaîne, vide) ne rend RIEN", () => {
    const { ctx, sent } = makeCtx();
    const rt = new TestRt(ctx);
    rt.feed(null);
    const before = sent.length;
    for (const params of [
      {},
      { channel: 42 },
      { channel: "" },
      null,
      "connu:a",
    ])
      rt.feed(JSON.stringify({ jsonrpc: "2.0", method: "subscribe", params }));
    expect(sent.length).toBe(before);
  });

  it("deux connexions sur le MÊME canal : chacune reçoit SON acquittement, jamais celui de l'autre", () => {
    const a = makeCtx();
    const b = makeCtx();
    const rtA = new TestRt(a.ctx);
    const rtB = new TestRt(b.ctx);
    rtA.feed(null);
    rtB.feed(null);
    rtA.feed(frame("connu:partage"));
    rtB.feed(frame("connu:partage"));
    expect(acksFor(a.sent)).to.deep.equal([{ channel: "connu:partage" }]);
    expect(acksFor(b.sent)).to.deep.equal([{ channel: "connu:partage" }]);
  });

  it("unsubscribe puis subscribe : un nouvel acquittement (l'état repart de zéro)", () => {
    const { ctx, sent } = makeCtx();
    const rt = new TestRt(ctx);
    rt.feed(null);
    rt.feed(frame("connu:a"));
    rt.feed(unsubFrame("connu:a"));
    rt.feed(frame("connu:a"));
    expect(acksFor(sent)).to.deep.equal([
      { channel: "connu:a" },
      { channel: "connu:a" },
    ]);
  });

  it("unsubscribe n'est JAMAIS acquitté (seul l'abonnement l'est)", () => {
    const { ctx, sent } = makeCtx();
    const rt = new TestRt(ctx);
    rt.feed(null);
    rt.feed(frame("connu:a"));
    const before = sent.length;
    rt.feed(unsubFrame("connu:a"));
    rt.feed(unsubFrame("connu:jamais-suivi"));
    expect(sent.length).toBe(before);
  });

  it("un canal libéré par le plafond redevient acquittable", () => {
    getRealtimeHub().setMaxChannelsPerConnection(1);
    const { ctx, sent } = makeCtx();
    const rt = new TestRt(ctx);
    rt.feed(null);
    rt.feed(frame("connu:a"));
    rt.feed(frame("connu:b")); // refusé : limit
    rt.feed(unsubFrame("connu:a"));
    rt.feed(frame("connu:b")); // place libre : accepté
    expect(acksFor(sent)).to.deep.equal([
      { channel: "connu:a" },
      { channel: "connu:b" },
    ]);
    expect(deniedFor(sent)).to.have.length(1);
  });

  it("la trame émise est la notification JSON-RPC 2.0 exacte, sans id", () => {
    const { ctx, sent } = makeCtx();
    const rt = new TestRt(ctx);
    rt.feed(null);
    rt.feed(frame("connu:a"));
    const ack = sent.find((f) => f.method === "realtime:subscribed");
    expect(ack).toEqual({
      jsonrpc: "2.0",
      method: "realtime:subscribed",
      params: { channel: "connu:a" },
    });
  });

  it("sens négatif : avant le welcome (handshake non abouti), aucun acquittement", () => {
    const { ctx, sent } = makeCtx();
    const rt = new TestRt(ctx);
    rt.feed(frame("connu:a")); // pas de feed(null) : la connexion n'est pas ouverte
    expect(acksFor(sent)).to.have.length(0);
  });
});
