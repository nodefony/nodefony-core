import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRealtimeHub } from "../../../../index";
import { createRealtimeHarness } from "../../../testing/index";
import type { IRealtimeHarness } from "../../../testing/index";
import {
  createTestFrameAuthorizer,
  createTestIdentity,
} from "@nodefony/security/testing";
import { BoardRealtime } from "../../fixtures/use-cases/boardTicker";

const open: IRealtimeHarness<BoardRealtime>[] = [];

async function connect(
  user: string,
  roles: string[],
): Promise<IRealtimeHarness<BoardRealtime>> {
  const h = createRealtimeHarness((ctx) => new BoardRealtime(ctx), {
    identity: createTestIdentity({ identifier: user, roles }),
    frameAuthorizer: createTestFrameAuthorizer(getRealtimeHub()),
    resetHub: open.length === 0,
  });
  await h.connect();
  open.push(h);
  return h;
}

describe("tableau de bord — un producteur pour N écrans", () => {
  // Seul le minuteur du producteur est simulé : le reste du hub garde le vrai temps.
  beforeEach(() =>
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] }),
  );
  afterEach(() => {
    for (const h of open.splice(0)) h.close();
    getRealtimeHub().clear();
    vi.useRealTimers();
  });

  it("deux écrans, un tick : UNE publication chacun — jamais un minuteur par écran", async () => {
    const a = await connect("ops-a", ["ROLE_SUPERVISOR"]);
    const b = await connect("ops-b", ["ROLE_SUPERVISOR"]);
    await a.subscribe("board:load");
    await b.subscribe("board:load");
    vi.advanceTimersByTime(BoardRealtime.TICK_MS);
    expect(a.messages("board:load")).toHaveLength(1);
    expect(b.messages("board:load")).toHaveLength(1);
  });

  it("le dernier écran parti, le minuteur s'arrête", async () => {
    const a = await connect("ops-a", ["ROLE_SUPERVISOR"]);
    await a.subscribe("board:load");
    expect(vi.getTimerCount()).toBe(1);
    a.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("un compte sans le rôle est refusé", async () => {
    const visitor = await connect("visitor", ["ROLE_USER"]);
    await visitor.subscribe("board:load");
    expect(visitor.denials()).toMatchObject([
      { channel: "board:load", reason: "forbidden" },
    ]);
  });
});
