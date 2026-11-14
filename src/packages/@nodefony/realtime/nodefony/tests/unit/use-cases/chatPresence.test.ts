import { afterEach, describe, expect, it } from "vitest";
import {
  PresenceView,
  REALTIME_PRESENCE_METHOD,
  isPresenceFrame,
} from "nodefony";
import type { IPresenceSnapshot } from "nodefony";
import { getRealtimeHub } from "../../../../index";
import { createRealtimeHarness } from "../../../testing/index";
import type { IRealtimeHarness } from "../../../testing/index";
import { createTestIdentity } from "@nodefony/security/testing";
import {
  ChatController,
  ROOM_CHANNEL,
} from "../../fixtures/use-cases/chatPresence";

const open: IRealtimeHarness<ChatController>[] = [];
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Une connexion : un compte (`name`), ou un anonyme. */
async function connect(
  name?: string,
): Promise<IRealtimeHarness<ChatController>> {
  const h = createRealtimeHarness((ctx) => new ChatController(ctx), {
    ...(name === undefined
      ? {}
      : { identity: createTestIdentity({ identifier: name }) }),
    resetHub: open.length === 0,
  });
  await h.connect();
  open.push(h);
  return h;
}

/** Ce que l'écran de cette connexion affiche : ses trames de présence, appliquées comme le fait le navigateur. */
function screenOf(h: IRealtimeHarness<ChatController>): IPresenceSnapshot {
  const view = new PresenceView(ROOM_CHANNEL);
  for (const frame of h.received) {
    if (
      frame.method === REALTIME_PRESENCE_METHOD &&
      isPresenceFrame(frame.params)
    )
      view.apply(frame.params);
  }
  return view.snapshot();
}

/** Attendre un FAIT, borné : les changements partent groupés, par fenêtre de 250 ms. */
async function until(fact: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !fact(); i++)
    await new Promise((r) => setTimeout(r, 25));
  expect(fact()).toBe(true);
}

describe("salon — la présence portée par le canal, la frappe en message éphémère", () => {
  afterEach(() => {
    for (const h of open.splice(0)) h.close();
    getRealtimeHub().clear();
  });

  it("être abonné, c'est être présent : un compte est nommé, un anonyme compté sans nom", async () => {
    const alice = await connect("alice");
    const guest = await connect();
    await alice.subscribe(ROOM_CHANNEL);
    await guest.subscribe(ROOM_CHANNEL);
    await flush();
    // Le dernier arrivé reçoit la liste complète dès son abonnement.
    const seen = screenOf(guest);
    expect(seen.ready).toBe(true);
    expect([...seen.members.keys()]).toEqual(["alice"]);
    expect([seen.count, seen.unnamed]).toEqual([1, 1]);
  });

  it("se déclarer « bob » ne nomme personne : seul un compte est nommé", async () => {
    const guest = await connect();
    await guest.subscribe(ROOM_CHANNEL);
    await guest.notify("chat:typing", { author: "bob" });
    await flush();
    expect(getRealtimeHub().presence(ROOM_CHANNEL)).toMatchObject({
      count: 0,
      unnamed: 1,
    });
  });

  it("la frappe arrive comme un message du canal, et ne touche pas la présence", async () => {
    const alice = await connect("alice");
    const bob = await connect("bob");
    await alice.subscribe(ROOM_CHANNEL);
    await bob.subscribe(ROOM_CHANNEL);
    await bob.notify("chat:typing", { author: "bob" });
    await flush();
    expect(alice.messages(ROOM_CHANNEL)).toEqual([{ typing: "bob" }]);
    expect(getRealtimeHub().presence(ROOM_CHANNEL)?.members.get("bob")).toEqual(
      {
        tabs: 1,
      },
    );
  });

  it("connexion fermée : le présent s'en va, chez le serveur PUIS sur l'écran des autres", async () => {
    const alice = await connect("alice");
    const bob = await connect("bob");
    await alice.subscribe(ROOM_CHANNEL);
    await bob.subscribe(ROOM_CHANNEL);
    await until(() => screenOf(alice).members.has("bob"));
    bob.close();
    await flush();
    expect(getRealtimeHub().presence(ROOM_CHANNEL)?.members.has("bob")).toBe(
      false,
    );
    await until(() => !screenOf(alice).members.has("bob"));
    expect(screenOf(alice).count).toBe(1);
  });
});
