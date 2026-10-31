import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NodefonySocket } from "../client/realtime/NodefonySocket";

/**
 * Réessai d'un abonnement refusé `unavailable` (#622, ADR-0021 §S10 bis
 * point 3) : le client rejoue le SEUL `subscribe` concerné, trois fois au plus,
 * recul à gigue complète (fenêtres 1 s, 2 s, 4 s), après le `retryAfterMs` du
 * serveur ; les trois autres motifs ne se réessaient jamais.
 */
interface Internals {
  handleMessage(raw: string): void;
  send(msg: unknown): boolean | void;
}

const frame = (method: string, params: unknown): string =>
  JSON.stringify({ jsonrpc: "2.0", method, params });
const welcome = frame("realtime:welcome", {
  ts: 0,
  protocol: "jsonrpc-2.0",
  channels: [],
  methods: [],
  subscriptionAcks: true,
});

function connected() {
  const client = new NodefonySocket({
    url: "ws://localhost/nodefony/api/realtime",
    autoReconnect: false,
  });
  const internal = client as unknown as Internals;
  const subscribes: string[] = [];
  internal.send = (msg: unknown) => {
    const f: unknown = typeof msg === "string" ? JSON.parse(msg) : msg;
    if (
      typeof f === "object" &&
      f !== null &&
      "method" in f &&
      f.method === "subscribe" &&
      "params" in f &&
      typeof f.params === "object" &&
      f.params !== null &&
      "channel" in f.params &&
      typeof f.params.channel === "string"
    ) {
      subscribes.push(f.params.channel);
    }
    return true;
  };
  const denials: Array<{ channel: string; reason: string }> = [];
  const notices: unknown[] = [];
  client.onDenied((d) => denials.push(d));
  client.onNotice((n) => notices.push(n));
  const deny = (channel: string, reason: string, extra: object = {}): void =>
    internal.handleMessage(
      frame("realtime:denied", { channel, reason, ...extra }),
    );
  const ack = (channel: string): void =>
    internal.handleMessage(frame("realtime:subscribed", { channel }));
  return { client, internal, subscribes, denials, notices, deny, ack };
}

function track(p: Promise<void>) {
  const s = { state: "pending" as "pending" | "resolved" | "rejected" };
  p.then(
    () => (s.state = "resolved"),
    () => (s.state = "rejected"),
  );
  return s;
}

let random: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.useFakeTimers();
  random = vi.spyOn(Math, "random").mockReturnValue(0.5);
});
afterEach(() => {
  random.mockRestore();
  vi.useRealTimers();
});

describe("#622 — le client réessaie un abonnement `unavailable`", () => {
  it("rejoue le seul subscribe concerné, en silence ; l'attente se résout à l'acquittement", async () => {
    const h = connected();
    h.client.subscribe("room:1");
    h.client.subscribe("room:2");
    h.internal.handleMessage(welcome);
    expect(h.subscribes).toEqual(["room:1", "room:2"]);
    const waiting = track(h.client.whenSubscribed("room:1"));
    h.deny("room:1", "unavailable");
    expect(h.denials).toEqual([]);
    expect(h.notices).toEqual([]);
    await vi.advanceTimersByTimeAsync(500);
    expect(h.subscribes).toEqual(["room:1", "room:2", "room:1"]);
    expect(waiting.state).toBe("pending");
    h.ack("room:1");
    await vi.advanceTimersByTimeAsync(0);
    expect(waiting.state).toBe("resolved");
    h.client.disconnect();
  });

  it("gigue COMPLÈTE : fenêtres [0, 1 s[, [0, 2 s[, [0, 4 s[ — bornes exactes", () => {
    const h = connected();
    h.client.subscribe("room:1");
    h.internal.handleMessage(welcome);
    random.mockReturnValue(0.999);
    for (const [attempt, delay] of [
      [1, 999],
      [2, 1998],
      [3, 3996],
    ] as const) {
      h.deny("room:1", "unavailable");
      vi.advanceTimersByTime(delay - 1);
      expect(h.subscribes.length, `réessai ${attempt} trop tôt`).toBe(attempt);
      vi.advanceTimersByTime(1);
      expect(h.subscribes.length, `réessai ${attempt}`).toBe(attempt + 1);
    }
    random.mockReturnValue(0);
    const h2 = connected();
    h2.client.subscribe("room:1");
    h2.internal.handleMessage(welcome);
    h2.deny("room:1", "unavailable");
    vi.advanceTimersByTime(0);
    expect(h2.subscribes.length, "gigue nulle : aussitôt").toBe(2);
    h.client.disconnect();
    h2.client.disconnect();
  });

  it("attend AU MOINS le retryAfterMs du serveur, gigue en plus", () => {
    const h = connected();
    h.client.subscribe("room:1");
    h.internal.handleMessage(welcome);
    random.mockReturnValue(0);
    h.deny("room:1", "unavailable", { retryAfterMs: 3000 });
    vi.advanceTimersByTime(2999);
    expect(h.subscribes.length).toBe(1);
    vi.advanceTimersByTime(1);
    expect(h.subscribes.length).toBe(2);
    random.mockReturnValue(0.5);
    h.deny("room:1", "unavailable", { retryAfterMs: 3000 });
    vi.advanceTimersByTime(3999);
    expect(h.subscribes.length).toBe(2);
    vi.advanceTimersByTime(1);
    expect(h.subscribes.length, "3000 + 0,5 × 2000").toBe(3);
    h.client.disconnect();
  });

  it("un retryAfterMs hostile (infini, négatif) n'est pas suivi", () => {
    const h = connected();
    h.client.subscribe("room:1");
    h.internal.handleMessage(welcome);
    h.internal.handleMessage(
      frame("realtime:denied", {
        channel: "room:1",
        reason: "unavailable",
        retryAfterMs: -5,
      }),
    );
    vi.advanceTimersByTime(500);
    expect(h.subscribes.length).toBe(2);
    h.client.disconnect();
  });

  it("trois réessais au plus : le quatrième refus remonte et rejette l'attente", async () => {
    const h = connected();
    h.client.subscribe("room:1");
    h.internal.handleMessage(welcome);
    const waiting = track(h.client.whenSubscribed("room:1"));
    for (let i = 0; i < 3; i++) {
      h.deny("room:1", "unavailable");
      await vi.advanceTimersByTimeAsync(4000);
    }
    expect(h.subscribes.length).toBe(4);
    expect(h.denials).toEqual([]);
    h.deny("room:1", "unavailable", { retryAfterMs: 10 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.subscribes.length, "aucun quatrième réessai").toBe(4);
    expect(h.denials).toEqual([
      { channel: "room:1", reason: "unavailable", retryAfterMs: 10 },
    ]);
    expect(h.notices).toHaveLength(1);
    expect(waiting.state).toBe("rejected");
    h.client.disconnect();
  });

  for (const reason of ["forbidden", "limit", "unknown"]) {
    it(`\`${reason}\` ne se réessaie jamais`, () => {
      const h = connected();
      h.client.subscribe("room:1");
      h.internal.handleMessage(welcome);
      h.deny("room:1", reason);
      vi.advanceTimersByTime(60_000);
      expect(h.subscribes.length).toBe(1);
      expect(h.denials).toEqual([{ channel: "room:1", reason }]);
      h.client.disconnect();
    });
  }

  it("canal qui n'est plus voulu : le refus remonte, rien n'est rejoué", () => {
    const h = connected();
    h.internal.handleMessage(welcome);
    h.deny("room:9", "unavailable");
    vi.advanceTimersByTime(10_000);
    expect(h.subscribes).toEqual([]);
    expect(h.denials).toEqual([{ channel: "room:9", reason: "unavailable" }]);
    h.client.disconnect();
  });

  it("désabonné pendant l'attente : minuteur coupé, aucun subscribe", () => {
    const h = connected();
    h.client.subscribe("room:1");
    h.internal.handleMessage(welcome);
    h.deny("room:1", "unavailable");
    const timers = vi.getTimerCount();
    h.client.unsubscribe("room:1");
    expect(vi.getTimerCount()).toBe(timers - 1);
    vi.advanceTimersByTime(10_000);
    expect(h.subscribes).toEqual(["room:1"]);
    h.client.disconnect();
  });

  it("déconnecté pendant l'attente : minuteurs coupés, aucun subscribe", () => {
    const h = connected();
    h.client.subscribe("room:1");
    h.client.subscribe("room:2");
    h.internal.handleMessage(welcome);
    const before = vi.getTimerCount();
    h.deny("room:1", "unavailable");
    h.deny("room:2", "unavailable");
    expect(vi.getTimerCount()).toBe(before + 2);
    h.client.disconnect();
    expect(vi.getTimerCount()).toBeLessThanOrEqual(before);
    vi.advanceTimersByTime(10_000);
    expect(h.subscribes).toEqual(["room:1", "room:2"]);
  });

  it("un acquittement remet les tentatives à zéro : un refus ultérieur a ses trois réessais", async () => {
    const h = connected();
    h.client.subscribe("room:1");
    h.internal.handleMessage(welcome);
    h.deny("room:1", "unavailable");
    await vi.advanceTimersByTimeAsync(1000);
    h.deny("room:1", "unavailable");
    await vi.advanceTimersByTimeAsync(2000);
    h.ack("room:1");
    for (let i = 0; i < 3; i++) {
      h.deny("room:1", "unavailable");
      await vi.advanceTimersByTimeAsync(4000);
    }
    expect(h.denials).toEqual([]);
    expect(h.subscribes.length).toBe(6);
    h.client.disconnect();
  });

  it("deux canaux : chacun ses tentatives", async () => {
    const h = connected();
    h.client.subscribe("room:1");
    h.client.subscribe("room:2");
    h.internal.handleMessage(welcome);
    for (let i = 0; i < 3; i++) {
      h.deny("room:1", "unavailable");
      await vi.advanceTimersByTimeAsync(4000);
    }
    h.deny("room:2", "unavailable");
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.denials).toEqual([]);
    expect(h.subscribes.filter((c) => c === "room:2")).toHaveLength(2);
    h.client.disconnect();
  });
});
