import { describe, it, expect, beforeEach } from "vitest";
import "reflect-metadata";
import { RealtimeController } from "../../src/server/RealtimeController.js";
import { getRealtimeHub } from "../../src/server/RealtimeHub.js";
import { RealtimeChannel } from "../../decorators/realtimeDecorators.js";
import type { RealtimePublish } from "../../interfaces/IRealtimeController.js";
import type { ContextType } from "@nodefony/http";

/**
 * `@RealtimeChannel("salle:*")` sert les noms que le motif couvre : la règle ET
 * la fabrique d'une famille de canaux s'écrivent une fois, sans surcharge de
 * `createRealtimeChannel`. Ordre : nom exact décoré, puis motifs du plus
 * spécifique au plus général. Une classe qui SURCHARGE `createRealtimeChannel`
 * garde la main : la surcharge seule décide, et son `null` reste un refus.
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
    type: "websocket",
    outboundTracer: () => null,
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

/** Qui a servi quel canal : `<méthode>:<nom reçu>`. */
const served: string[] = [];

class Rooms extends RealtimeController {
  constructor(ctx: unknown) {
    super("test-rt-pattern", ctx as ContextType);
  }
  @RealtimeChannel("salle:*")
  room(channel: string): () => void {
    served.push(`room:${channel}`);
    return () => {};
  }
  @RealtimeChannel("salle:vip:*")
  vip(channel: string): () => void {
    served.push(`vip:${channel}`);
    return () => {};
  }
  @RealtimeChannel("salle:accueil")
  lobby(channel: string): () => void {
    served.push(`lobby:${channel}`);
    return () => {};
  }
  feed(message: string | null): void {
    this.handleRealtime(message);
  }
}

/** Une classe existante : motif ET surcharge — la surcharge décide seule. */
class Legacy extends Rooms {
  override createRealtimeChannel(channel: string, _publish: RealtimePublish) {
    if (channel !== "salle:ancienne") return null;
    served.push(`override:${channel}`);
    return () => {};
  }
}

const frame = (channel: string): string =>
  JSON.stringify({ jsonrpc: "2.0", method: "subscribe", params: { channel } });

const deniedFor = (sent: Array<Record<string, unknown>>): unknown[] =>
  sent.filter((f) => f.method === "realtime:denied").map((f) => f.params);

function subscribe(channel: string, Ctor: typeof Rooms = Rooms): unknown[] {
  const { ctx, sent } = makeCtx();
  const rt = new Ctor(ctx);
  rt.feed(null);
  rt.feed(frame(channel));
  return deniedFor(sent);
}

describe("@RealtimeChannel sous un motif — la famille servie sans surcharge", () => {
  beforeEach(() => {
    getRealtimeHub().clear();
    getRealtimeHub().setMaxChannelsPerConnection(256);
    served.length = 0;
  });

  it("🔴 un nom couvert par le motif est servi, la méthode reçoit le nom RÉEL", () => {
    expect(subscribe("salle:42")).to.deep.equal([]);
    expect(served).to.deep.equal(["room:salle:42"]);
  });

  it("le motif le plus spécifique gagne (même départage que les politiques)", () => {
    expect(subscribe("salle:vip:7")).to.deep.equal([]);
    expect(served).to.deep.equal(["vip:salle:vip:7"]);
  });

  it("le nom exact décoré passe avant tout motif", () => {
    subscribe("salle:accueil");
    expect(served).to.deep.equal(["lobby:salle:accueil"]);
  });

  it("une surcharge garde la main : elle sert ce qu'elle sert…", () => {
    expect(subscribe("salle:ancienne", Legacy)).to.deep.equal([]);
    expect(served).to.deep.equal(["override:salle:ancienne"]);
  });

  it("🔴 …et son `null` reste un REFUS, même sous un motif décoré", () => {
    expect(subscribe("salle:42", Legacy)).to.deep.equal([
      { channel: "salle:42", reason: "unknown" },
    ]);
    expect(served).to.deep.equal([]);
  });

  it("un nom qu'aucun motif ne couvre reste « inconnu »", () => {
    expect(subscribe("cuisine:1")).to.deep.equal([
      { channel: "cuisine:1", reason: "unknown" },
    ]);
    expect(served).to.deep.equal([]);
  });

  it("le producteur est PARTAGÉ : un second abonné ne rejoue pas la fabrique", () => {
    const first = makeCtx();
    const a = new Rooms(first.ctx);
    a.feed(null);
    a.feed(frame("salle:9"));
    const second = makeCtx();
    const b = new Rooms(second.ctx);
    b.feed(null);
    b.feed(frame("salle:9"));
    expect(deniedFor(first.sent)).to.deep.equal([]);
    expect(deniedFor(second.sent)).to.deep.equal([]);
    expect(served).to.deep.equal(["room:salle:9"]);
  });
});
