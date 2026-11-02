import { afterEach, describe, expect, it } from "vitest";
import { getRealtimeHub } from "../../../../index";
import { createRealtimeHarness } from "../../../testing/index";
import type { IRealtimeHarness } from "../../../testing/index";
import { createTestIdentity } from "@nodefony/security/testing";
import { MatchRealtime, players } from "../../fixtures/use-cases/matchmaking";

const open: IRealtimeHarness<MatchRealtime>[] = [];
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

async function connect(user: string): Promise<IRealtimeHarness<MatchRealtime>> {
  const h = createRealtimeHarness((ctx) => new MatchRealtime(ctx), {
    identity: createTestIdentity({ identifier: user }),
    resetHub: open.length === 0,
  });
  await h.connect();
  open.push(h);
  return h;
}

describe("recherche de partie — abonné d'office, et l'appartenance survit à la reconnexion", () => {
  afterEach(() => {
    for (const h of open.splice(0)) h.close();
    players.clear();
    getRealtimeHub().clear();
  });

  it("placé sans s'abonner, le joueur retrouve sa partie après une coupure", async () => {
    const alice = await connect("alice");
    await alice.notify("match:find");
    await flush();
    expect(alice.subscriptions()).toEqual(["match:42"]);
    alice.close(); // un tunnel
    const again = await connect("alice"); // le navigateur rejoue `subscribe`
    await again.subscribe("match:42");
    await flush();
    expect(again.denials()).toHaveLength(0);
  });

  it("un joueur d'une autre partie n'entre pas", async () => {
    const alice = await connect("alice");
    await alice.notify("match:find");
    await flush();
    const mallory = await connect("mallory");
    await mallory.subscribe("match:42");
    await flush();
    expect(mallory.denials()).toMatchObject([
      { channel: "match:42", reason: "forbidden" },
    ]);
  });
});
