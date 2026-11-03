import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getRealtimeHub } from "../../../../index";
import { createRealtimeHarness } from "../../../testing/index";
import type { IRealtimeHarness } from "../../../testing/index";
import { createTestIdentity } from "@nodefony/security/testing";
import { createTestModule } from "nodefony/testing";
import {
  MatchAdmission,
  MatchRealtime,
  MatchmakingService,
} from "../../fixtures/use-cases/matchmaking";

const open: IRealtimeHarness<MatchRealtime>[] = [];
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
let matches: MatchmakingService;

async function connect(user: string): Promise<IRealtimeHarness<MatchRealtime>> {
  // Le service et l'admission passés à la main, comme l'injecteur en production.
  const h = createRealtimeHarness((ctx) => new MatchRealtime(ctx, matches), {
    identity: createTestIdentity({ identifier: user }),
    admissions: [new MatchAdmission(matches)],
    resetHub: open.length === 0,
  });
  await h.connect();
  open.push(h);
  return h;
}

describe("recherche de partie — abonné d'office, et l'appartenance survit à la reconnexion", () => {
  beforeEach(() => {
    matches = new MatchmakingService(createTestModule());
  });
  afterEach(() => {
    for (const h of open.splice(0)) h.close();
    getRealtimeHub().clear();
  });

  it("deux joueurs par partie, la troisième en ouvre une autre", async () => {
    const players = await Promise.all(
      ["alice", "bob", "carol"].map((name) => connect(name)),
    );
    for (const player of players) await player.notify("match:find");
    await flush();
    expect(players.map((p) => p.subscriptions())).toEqual([
      ["match:1"],
      ["match:1"],
      ["match:2"],
    ]);
  });

  it("placé sans s'abonner, le joueur retrouve sa partie après une coupure", async () => {
    const alice = await connect("alice");
    await alice.notify("match:find");
    await flush();
    expect(alice.subscriptions()).toEqual(["match:1"]);
    alice.close(); // un tunnel
    const again = await connect("alice"); // le navigateur rejoue `subscribe`
    await again.subscribe("match:1");
    await flush();
    expect(again.denials()).toHaveLength(0);
  });

  it("un joueur d'une autre partie n'entre pas", async () => {
    const alice = await connect("alice");
    await alice.notify("match:find");
    await flush();
    const mallory = await connect("mallory");
    await mallory.subscribe("match:1");
    await flush();
    expect(mallory.denials()).toMatchObject([
      { channel: "match:1", reason: "forbidden" },
    ]);
  });
});
