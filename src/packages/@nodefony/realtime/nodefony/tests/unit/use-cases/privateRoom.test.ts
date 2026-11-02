import { afterEach, describe, expect, it } from "vitest";
import { getRealtimeHub } from "../../../../index";
import { createRealtimeHarness } from "../../../testing/index";
import type { IRealtimeHarness } from "../../../testing/index";
import { createTestIdentity } from "@nodefony/security/testing";
import {
  RoomRealtime,
  exclude,
  guests,
} from "../../fixtures/use-cases/privateRoom";

const open: IRealtimeHarness<RoomRealtime>[] = [];
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Une connexion par compte ; le hub est partagé entre elles. */
async function connect(user: string): Promise<IRealtimeHarness<RoomRealtime>> {
  const h = createRealtimeHarness((ctx) => new RoomRealtime(ctx), {
    identity: createTestIdentity({ identifier: user }),
    resetHub: open.length === 0,
  });
  await h.connect();
  open.push(h);
  return h;
}

const closedOf = (h: IRealtimeHarness<RoomRealtime>): unknown[] =>
  h.received.filter((f) => f.method === "realtime:closed").map((f) => f.params);

describe("salon privé — `allow` admet, l'exclusion coupe ET empêche de revenir", () => {
  afterEach(() => {
    for (const h of open.splice(0)) h.close();
    guests.clear();
    getRealtimeHub().clear();
  });

  it("l'invité entre, l'intrus est refusé par le MÊME motif", async () => {
    guests.set("room:7", new Set(["alice", "bob"]));
    const bob = await connect("bob");
    const mallory = await connect("mallory");
    await bob.subscribe("room:7");
    await mallory.subscribe("room:7");
    await flush();
    expect(bob.subscriptions()).toEqual(["room:7"]);
    expect(mallory.denials()).toMatchObject([
      { channel: "room:7", reason: "forbidden" },
    ]);
  });

  it("seul un invité écrit ; l'auteur vient de la connexion, pas du message", async () => {
    guests.set("room:7", new Set(["alice", "bob"]));
    const alice = await connect("alice");
    const bob = await connect("bob");
    const mallory = await connect("mallory");
    await alice.subscribe("room:7");
    await bob.notify("room:send", {
      room: "room:7",
      text: "salut",
      author: "alice",
    });
    await mallory.notify("room:send", { room: "room:7", text: "intrus" });
    await flush();
    expect(alice.messages("room:7")).toEqual([
      { author: "bob", text: "salut" },
    ]);
  });

  it("exclu : `evicted` tout de suite, puis refusé à la page rechargée", async () => {
    guests.set("room:7", new Set(["alice", "bob"]));
    const bob = await connect("bob");
    await bob.subscribe("room:7");
    await flush();
    exclude("room:7", "bob");
    expect(closedOf(bob)).toEqual([{ channel: "room:7", reason: "evicted" }]);
    const reloaded = await connect("bob"); // une page rechargée refait `subscribe`
    await reloaded.subscribe("room:7");
    await flush();
    expect(reloaded.denials()).toHaveLength(1);
  });
});
