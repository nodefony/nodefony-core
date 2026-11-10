import { afterEach, describe, expect, it, vi } from "vitest";
import { NodefonySocket } from "../client/realtime/NodefonySocket";
import { observePresence } from "../client/realtime/observe";
import {
  EMPTY_PRESENCE,
  PRESENCE_RESYNC_MS,
  type IPresenceSnapshot,
} from "../realtime/presenceView";

/**
 * Présence côté navigateur (ADR-0025 P2 bis / P3, #760 étape 3) : la socket applique
 * les trames `realtime:presence` à la vue PURE du cœur, réémet `subscribe` sur un trou
 * (une fois par canal toutes les 2 s au plus, gigue), et fige ses vues à la fermeture
 * comme à chaque `subscribe` émis.
 *
 * Patron de `NodefonySocketClosed.test.ts` : `handleMessage` exercé sans vrai
 * WebSocket, `writeFrame` remplacé pour lire ce que le client émet.
 */
interface IInternals {
  handleMessage(raw: string): void;
  admitFrame(): boolean;
  writeFrame(data: unknown, msg: unknown): boolean | void;
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
const presence = (params: object): string =>
  frame("realtime:presence", { channel: "room:1", unnamed: 0, ...params });
const list = (version: number, members: (string | number)[]): string =>
  presence({ version, count: members.length / 2, members });
const changes = (
  version: number,
  set: (string | number)[],
  count: number,
): string => presence({ version, count, changes: { set } });

function newClient(): {
  client: NodefonySocket;
  internal: IInternals;
  subscribes: () => number;
} {
  const client = new NodefonySocket({
    url: "ws://localhost/nodefony/api/realtime",
    autoReconnect: false,
  });
  const internal = client as unknown as IInternals;
  const emitted: string[] = [];
  internal.admitFrame = () => true;
  internal.writeFrame = (data) => {
    const msg: unknown = JSON.parse(String(data));
    if (
      typeof msg === "object" &&
      msg !== null &&
      "method" in msg &&
      msg.method === "subscribe"
    )
      emitted.push("subscribe");
    return true;
  };
  return { client, internal, subscribes: () => emitted.length };
}

/** Client accueilli, abonné à `room:1` par le socle des liaisons, instantanés relevés. */
function observed(): ReturnType<typeof newClient> & {
  seen: IPresenceSnapshot[];
  dispose: () => void;
} {
  const c = newClient();
  const seen: IPresenceSnapshot[] = [];
  c.internal.handleMessage(welcome);
  const dispose = observePresence(c.client, "room:1", (s) => seen.push(s));
  return { ...c, seen, dispose };
}

const names = (s: IPresenceSnapshot): string[] => [...s.members.keys()];

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("NodefonySocket — présence d'un canal", () => {
  it("observePresence : instantané neutre tout de suite, `subscribe` émis, la liste remplit la vue", () => {
    const { client, internal, seen, subscribes, dispose } = observed();
    expect(seen).to.have.length(1);
    expect(seen[0]?.ready).toBe(false);
    expect(subscribes()).toBe(1);
    internal.handleMessage(list(3, ["alice", 2, "bob", 1]));
    const last = seen.at(-1);
    expect(last?.ready).toBe(true);
    expect(last?.count).toBe(2);
    expect(last?.members.get("alice")).to.deep.equal({ tabs: 2 });
    expect(client.presence("room:1")).toBe(last);
    internal.handleMessage(changes(4, ["carol", 1], 3));
    expect(names(client.presence("room:1"))).to.deep.equal([
      "alice",
      "bob",
      "carol",
    ]);
    dispose();
    client.disconnect();
  });

  it("🔴 trou de version : rien d'appliqué, vue figée, `subscribe` RÉÉMIS, la liste referme", () => {
    const { client, internal, subscribes, dispose } = observed();
    internal.handleMessage(list(3, ["alice", 1]));
    internal.handleMessage(changes(5, ["zed", 1], 2)); // la 4 manque
    const frozen = client.presence("room:1");
    expect(names(frozen)).to.deep.equal(["alice"]);
    expect(frozen.partial).toBe(true);
    expect(subscribes()).toBe(2);
    internal.handleMessage(list(5, ["alice", 1, "zed", 1]));
    expect(client.presence("room:1").partial).toBe(false);
    expect(names(client.presence("room:1"))).to.deep.equal(["alice", "zed"]);
    dispose();
    client.disconnect();
  });

  it("🔴 re-`subscribe` limité : un seul par canal toutes les 2 s (gigue comprise), puis le suivant à l'échéance", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(1); // gigue maximale : +25 %
    const { client, internal, subscribes, dispose } = observed();
    internal.handleMessage(list(1, ["a", 1]));
    internal.handleMessage(changes(3, ["b", 1], 2)); // trou → 1er re-subscribe, immédiat
    expect(subscribes()).toBe(2);
    // La liste est perdue (contre-pression) : les changements suivants restent en trou.
    internal.handleMessage(changes(4, ["c", 1], 3));
    internal.handleMessage(changes(5, ["d", 1], 4));
    expect(subscribes()).toBe(2);
    vi.advanceTimersByTime(PRESENCE_RESYNC_MS * 1.25 - 1);
    expect(subscribes()).toBe(2);
    vi.advanceTimersByTime(1);
    expect(subscribes()).toBe(3);
    dispose();
    client.disconnect();
  });

  it("trame déjà vue : jetée sans annonce", () => {
    const { client, internal, seen, dispose } = observed();
    internal.handleMessage(list(3, ["a", 1]));
    internal.handleMessage(changes(4, ["b", 1], 2));
    const n = seen.length;
    internal.handleMessage(changes(4, ["c", 1], 3));
    expect(seen).to.have.length(n);
    dispose();
    client.disconnect();
  });

  it("🔴 rejeu au welcome : chaque vue perd sa référence — le changement « attendu » d'un autre pod ne s'applique pas", () => {
    const { client, internal, subscribes, dispose } = observed();
    internal.handleMessage(list(3, ["a", 1]));
    internal.handleMessage(welcome); // reconnecté (autre pod)
    expect(subscribes()).toBe(2);
    expect(client.presence("room:1").partial).toBe(true);
    internal.handleMessage(changes(4, ["intrus", 1], 2));
    expect(names(client.presence("room:1"))).to.deep.equal(["a"]);
    internal.handleMessage(list(40, ["b", 1]));
    expect(names(client.presence("room:1"))).to.deep.equal(["b"]);
    dispose();
    client.disconnect();
  });

  it("disconnect : vue gardée, figée", () => {
    const { client, internal, dispose } = observed();
    internal.handleMessage(list(3, ["a", 1]));
    client.disconnect();
    const snap = client.presence("room:1");
    expect(snap.partial).toBe(true);
    expect(names(snap)).to.deep.equal(["a"]);
    dispose();
  });

  it("une trame mal formée est jetée sans un mot ; un canal non suivi n'est pas lu", () => {
    const { client, internal, seen, dispose } = observed();
    internal.handleMessage(presence({ version: 1, count: 1, members: ["a"] }));
    internal.handleMessage(
      frame("realtime:presence", {
        channel: "room:2",
        version: 1,
        count: 1,
        unnamed: 0,
        members: ["x", 1],
      }),
    );
    expect(seen).to.have.length(1);
    expect(client.presence("room:2")).toBe(EMPTY_PRESENCE);
    dispose();
    client.disconnect();
  });

  it("dispose : `unsubscribe` émis, vue oubliée au dernier écouteur, aucun minuteur restant", () => {
    vi.useFakeTimers();
    const { client, internal, dispose } = observed();
    internal.handleMessage(list(1, ["a", 1]));
    internal.handleMessage(changes(3, ["b", 1], 2)); // 1er re-subscribe
    internal.handleMessage(changes(4, ["c", 1], 3)); // 2e différé (minuteur)
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    dispose();
    expect(client.presence("room:1")).toBe(EMPTY_PRESENCE);
    client.disconnect();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("sans `onPresence`, aucune structure : la trame passe aux écouteurs génériques seulement", () => {
    const { client, internal } = newClient();
    const raw: unknown[] = [];
    client.on("realtime:presence", (p) => raw.push(p));
    internal.handleMessage(welcome);
    internal.handleMessage(list(1, ["a", 1]));
    expect(raw).to.have.length(1);
    expect(client.presence("room:1")).toBe(EMPTY_PRESENCE);
    client.disconnect();
  });
});
