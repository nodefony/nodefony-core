import { afterEach, describe, expect, it } from "vitest";
import { getRealtimeHub } from "../../../../index";
import { createRealtimeHarness } from "../../../testing/index";
import type { IRealtimeHarness } from "../../../testing/index";
import {
  createTestFrameAuthorizer,
  createTestIdentity,
} from "@nodefony/security/testing";
import {
  ArenaRealtime,
  positions,
  tick,
} from "../../fixtures/use-cases/gameMoves";

const open: IRealtimeHarness<ArenaRealtime>[] = [];
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

async function connect(
  user: string,
  roles: string[],
): Promise<IRealtimeHarness<ArenaRealtime>> {
  const h = createRealtimeHarness((ctx) => new ArenaRealtime(ctx), {
    identity: createTestIdentity({ identifier: user, roles }),
    // Le VRAI verrou du pare-feu : sans lui, `roles` n'est jugé par personne.
    frameAuthorizer: createTestFrameAuthorizer(getRealtimeHub()),
    resetHub: open.length === 0,
  });
  await h.connect();
  open.push(h);
  return h;
}

describe("jeu — seule la dernière position compte, diffusée au rythme du serveur", () => {
  afterEach(() => {
    for (const h of open.splice(0)) h.close();
    positions.clear();
    getRealtimeHub().clear();
  });

  it("soixante coups, un seul état diffusé : le dernier", async () => {
    const alice = await connect("alice", ["ROLE_PLAYER"]);
    await alice.subscribe("game:state");
    for (let x = 0; x < 60; x++) await alice.notify("game:move", { x, y: 1 });
    await alice.notify("game:move", { x: "pas un nombre", y: 1 });
    expect(alice.messages("game:state")).toHaveLength(0); // rien avant le tick
    tick(); // en production : `setInterval(tick, 50)`
    expect(alice.messages("game:state")).toEqual([{ alice: { x: 59, y: 1 } }]);
  });

  it("sans ROLE_PLAYER, ni l'état ni les coups", async () => {
    const watcher = await connect("watcher", ["ROLE_USER"]);
    await watcher.subscribe("game:state");
    await watcher.notify("game:move", { x: 9, y: 9 });
    await flush();
    expect(watcher.denials().map((d) => d.channel)).toContain("game:state");
    expect(positions.has("watcher")).toBe(false);
  });
});
