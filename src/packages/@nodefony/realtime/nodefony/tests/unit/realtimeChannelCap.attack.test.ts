import { describe, it, expect, beforeEach } from "vitest";
import "reflect-metadata";
import { RealtimeController } from "../../src/server/RealtimeController.js";
import { getRealtimeHub } from "../../src/server/RealtimeHub.js";
import type { RealtimePublish } from "../../interfaces/IRealtimeController.js";
import type { ContextType } from "@nodefony/http";

/**
 * Phase 0.6 — REVUE realtime, F6a : accumulation illimitée de canaux par connexion.
 *
 * `RealtimeController.startChannel` alimente `state.channels: Map` à chaque subscribe.
 * SANS borne, un socket peut subscribe à N canaux distincts — chacun ouvre 1 ticker
 * hub + 1 provider + 1 entrée Map → OOM (DoS mémoire par UNE connexion). La garde
 * anti-OOM = un plafond CONFIGURABLE par connexion (`limits.maxChannelsPerConnection`,
 * défaut 256, `null` = illimité) : au-delà, le subscribe est REFUSÉ (le canal n'est pas
 * ouvert, le hub n'est jamais appelé) et le client reçoit `realtime:denied` (motif
 * générique `limit` — pas de dégradation silencieuse). GARDE, pas une bride : sous le
 * seuil le multiplexage N-canaux reste libre (North Star socket Nodefony).
 * Cf project_realtime_dos_limits_kit, project_realtime_nodefony_socket_vision.
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

/** Sous-classe de test : accepte TOUT canal (provider = disposer no-op). */
class TestRt extends RealtimeController {
  channelCalls: string[] = [];
  constructor(ctx: unknown) {
    super("test-rt-cap", ctx as ContextType);
  }
  createRealtimeChannel(channel: string, _publish: RealtimePublish) {
    this.channelCalls.push(channel);
    return () => {};
  }
  feed(message: string | null): void {
    this.handleRealtime(message);
  }
}

const frame = (channel: string): string =>
  JSON.stringify({ jsonrpc: "2.0", method: "subscribe", params: { channel } });

const deniedFor = (sent: Array<Record<string, unknown>>): unknown[] =>
  sent.filter((f) => f.method === "realtime:denied").map((f) => f.params);

describe("0.6 F6a — cap de canaux par connexion (anti-OOM)", () => {
  // Hub singleton partagé → reset canaux + restaure le plafond par défaut entre tests.
  beforeEach(() => {
    getRealtimeHub().clear();
    getRealtimeHub().setMaxChannelsPerConnection(256);
  });

  it("défaut du hub = 256 (garde active sans wiring RealtimeService)", () => {
    expect(getRealtimeHub().maxChannelsPerConnection).to.equal(256);
  });

  it("[F6a] au-delà du plafond, le subscribe est REFUSÉ (hub jamais appelé)", () => {
    getRealtimeHub().setMaxChannelsPerConnection(3);
    const { ctx, sent } = makeCtx();
    const rt = new TestRt(ctx);
    rt.feed(null);
    for (const ch of ["c1", "c2", "c3", "c4", "c5"]) rt.feed(frame(ch));
    // Seuls les 3 premiers atteignent le hub (createRealtimeChannel).
    expect(rt.channelCalls).to.deep.equal(["c1", "c2", "c3"]);
  });

  it("[F6a] le refus est OBSERVABLE : realtime:denied {reason:'limit'} (pas de dégradation silencieuse)", () => {
    getRealtimeHub().setMaxChannelsPerConnection(2);
    const { ctx, sent } = makeCtx();
    const rt = new TestRt(ctx);
    rt.feed(null);
    for (const ch of ["a", "b", "c", "d"]) rt.feed(frame(ch));
    const denied = deniedFor(sent);
    expect(denied).to.deep.equal([
      { channel: "c", reason: "limit" },
      { channel: "d", reason: "limit" },
    ]);
  });

  it("re-subscribe d'un canal DÉJÀ tenu ne consomme pas de slot (idempotence avant cap)", () => {
    getRealtimeHub().setMaxChannelsPerConnection(2);
    const { ctx, sent } = makeCtx();
    const rt = new TestRt(ctx);
    rt.feed(null);
    rt.feed(frame("x"));
    rt.feed(frame("x")); // doublon → idempotent, ne compte pas
    rt.feed(frame("y")); // 2e canal distinct → tient dans le cap de 2
    expect(rt.channelCalls).to.deep.equal(["x", "y"]);
    expect(deniedFor(sent)).to.have.length(0);
  });

  it("null = illimité (opt-out explicite) : le multiplexage N-canaux reste libre", () => {
    getRealtimeHub().setMaxChannelsPerConnection(null);
    const { ctx, sent } = makeCtx();
    const rt = new TestRt(ctx);
    rt.feed(null);
    for (let i = 0; i < 300; i++) rt.feed(frame(`ch${i}`));
    expect(rt.channelCalls).to.have.length(300);
    expect(deniedFor(sent)).to.have.length(0);
  });
});
