import { describe, expect, it } from "vitest";
import { NodefonySocket } from "../client/realtime/NodefonySocket";
import type { IRealtimeClosed, IRealtimeSubscribed } from "../index";

/**
 * Abonnement imposé (`realtime:subscribed { imposed: true }`) et fin décidée par
 * le serveur (`realtime:closed`) — ADR-0022 §6 décisions 2 et 3, #623.
 *
 * On exerce `handleMessage` (point d'arrivée des frames) sans vrai WebSocket ;
 * `writeFrame` est remplacé pour lire ce que le client RÉÉMET (le rejeu au
 * welcome est ce qui distingue un canal fini d'un canal refusé).
 */
interface IInternals {
  handleMessage(raw: string): void;
  admitFrame(): boolean;
  writeFrame(data: unknown, msg: unknown): boolean | void;
  isSubscriptionActive(channel: string): boolean;
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
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Client au transport « ouvert », qui note chaque frame émise. */
function newClient(): {
  client: NodefonySocket;
  internal: IInternals;
  emitted: { method: string; channel: unknown }[];
} {
  const client = new NodefonySocket({
    url: "ws://localhost/nodefony/api/realtime",
    autoReconnect: false,
  });
  const internal = client as unknown as IInternals;
  const emitted: { method: string; channel: unknown }[] = [];
  internal.admitFrame = () => true;
  internal.writeFrame = (data) => {
    const msg = JSON.parse(String(data)) as {
      method?: string;
      params?: { channel?: unknown };
    };
    if (msg.method !== undefined)
      emitted.push({ method: msg.method, channel: msg.params?.channel });
    return true;
  };
  return { client, internal, emitted };
}

const subscribesOf = (
  emitted: { method: string; channel: unknown }[],
): unknown[] =>
  emitted.filter((e) => e.method === "subscribe").map((e) => e.channel);

describe("NodefonySocket — abonnement imposé par le serveur (#623)", () => {
  it("un acquittement `imposed` inscrit le canal, le dit, et le rejoue à la reconnexion", () => {
    const { client, internal, emitted } = newClient();
    const acks: IRealtimeSubscribed[] = [];
    client.onSubscribed((a) => acks.push(a));
    internal.handleMessage(welcome);
    internal.handleMessage(
      frame("realtime:subscribed", { channel: "room:42", imposed: true }),
    );
    expect(acks).to.deep.equal([{ channel: "room:42", imposed: true }]);
    expect(internal.isSubscriptionActive("room:42")).toBe(true);
    // Nouvelle poignée de main : le canal imposé fait partie du rejeu.
    emitted.length = 0;
    internal.handleMessage(welcome);
    expect(subscribesOf(emitted)).to.deep.equal(["room:42"]);
    client.disconnect();
  });

  it("sens négatif : `imposed` doit valoir EXACTEMENT true — sinon l'acquittement d'un canal non suivi reste ignoré", () => {
    for (const imposed of ["true", 1, {}]) {
      const { client, internal } = newClient();
      internal.handleMessage(welcome);
      internal.handleMessage(
        frame("realtime:subscribed", { channel: "room:42", imposed }),
      );
      expect(internal.isSubscriptionActive("room:42")).toBe(false);
      client.disconnect();
    }
  });

  it("le client peut quitter un canal imposé : un seul consommateur, `unsubscribe` part au serveur", () => {
    const { client, internal, emitted } = newClient();
    internal.handleMessage(welcome);
    internal.handleMessage(
      frame("realtime:subscribed", { channel: "room:42", imposed: true }),
    );
    client.unsubscribe("room:42");
    expect(emitted.at(-1)).to.deep.equal({
      method: "unsubscribe",
      channel: "room:42",
    });
    client.disconnect();
  });
});

describe("NodefonySocket — realtime:closed (fin décidée par le serveur, #623)", () => {
  it("🔴 un canal terminé est retiré pour TOUS ses consommateurs et ne se rejoue PAS", () => {
    const { client, internal, emitted } = newClient();
    const closed: IRealtimeClosed[] = [];
    client.onClosed((c) => closed.push(c));
    client.subscribe("room:42");
    client.subscribe("room:42"); // un hook ET un magasin
    client.subscribe("app:autre");
    internal.handleMessage(welcome);
    internal.handleMessage(
      frame("realtime:closed", { channel: "room:42", reason: "ended" }),
    );
    expect(closed).to.deep.equal([{ channel: "room:42", reason: "ended" }]);
    emitted.length = 0;
    internal.handleMessage(welcome);
    expect(subscribesOf(emitted)).to.deep.equal(["app:autre"]);
    // Les consommateurs qui rendent ensuite le canal n'émettent plus rien.
    emitted.length = 0;
    client.unsubscribe("room:42");
    client.unsubscribe("room:42");
    expect(emitted).to.have.length(0);
    client.disconnect();
  });

  it("une éjection rejette l'attente d'acquittement, la fin en `cause`", async () => {
    const { client, internal } = newClient();
    client.subscribe("room:42");
    internal.handleMessage(welcome);
    const p = client.whenSubscribed("room:42");
    internal.handleMessage(
      frame("realtime:closed", { channel: "room:42", reason: "evicted" }),
    );
    const err = await p.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).cause).to.deep.equal({
      channel: "room:42",
      reason: "evicted",
    });
    client.disconnect();
  });

  it("sens négatif : une fin mal formée (motif inventé, canal non-chaîne) ne retire rien", async () => {
    const { client, internal } = newClient();
    const closed: unknown[] = [];
    client.onClosed((c) => closed.push(c));
    client.subscribe("room:42");
    internal.handleMessage(welcome);
    internal.handleMessage(
      frame("realtime:subscribed", { channel: "room:42" }),
    );
    for (const params of [
      undefined,
      {},
      { channel: "room:42", reason: "kicked" },
      { channel: 42, reason: "ended" },
      ["room:42", "ended"],
    ])
      internal.handleMessage(frame("realtime:closed", params));
    await flush();
    expect(closed).to.have.length(0);
    expect(internal.isSubscriptionActive("room:42")).toBe(true);
    client.disconnect();
  });

  it("une fin pour un canal que le client ne suit pas est ignorée", () => {
    const { client, internal } = newClient();
    const closed: unknown[] = [];
    client.onClosed((c) => closed.push(c));
    internal.handleMessage(welcome);
    internal.handleMessage(
      frame("realtime:closed", { channel: "room:9", reason: "ended" }),
    );
    expect(closed).to.have.length(0);
    client.disconnect();
  });

  it("onClosed rend un dispose qui coupe l'écouteur", () => {
    const { client, internal } = newClient();
    const closed: unknown[] = [];
    const off = client.onClosed((c) => closed.push(c));
    client.subscribe("a");
    client.subscribe("b");
    internal.handleMessage(welcome);
    internal.handleMessage(
      frame("realtime:closed", { channel: "a", reason: "ended" }),
    );
    off();
    internal.handleMessage(
      frame("realtime:closed", { channel: "b", reason: "ended" }),
    );
    expect(closed).to.have.length(1);
    client.disconnect();
  });
});
