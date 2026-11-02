import { afterEach, describe, expect, it } from "vitest";
import { getRealtimeHub } from "../../../../index";
import { createRealtimeHarness } from "../../../testing/index";
import type { IRealtimeHarness } from "../../../testing/index";
import {
  createTestFrameAuthorizer,
  createTestIdentity,
} from "@nodefony/security/testing";
import { SensorRealtime } from "../../fixtures/use-cases/sensors";

const open: IRealtimeHarness<SensorRealtime>[] = [];
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

async function connect(
  user: string,
  rights: { roles?: string[]; scopes?: string[] },
): Promise<IRealtimeHarness<SensorRealtime>> {
  const h = createRealtimeHarness((ctx) => new SensorRealtime(ctx), {
    identity: createTestIdentity({ identifier: user, ...rights }),
    frameAuthorizer: createTestFrameAuthorizer(getRealtimeHub()),
    resetHub: open.length === 0,
  });
  await h.connect();
  open.push(h);
  return h;
}

describe("sondes — la portée du jeton écrit, le rôle lit", () => {
  afterEach(() => {
    for (const h of open.splice(0)) h.close();
    getRealtimeHub().clear();
  });

  it("une mesure de sonde atteint l'écran ; une mesure malformée, nulle part", async () => {
    const screen = await connect("screen", { roles: ["ROLE_SUPERVISOR"] });
    const probe = await connect("probe-1", {
      roles: [],
      scopes: ["telemetry:write"],
    });
    await screen.subscribe("sensor:dashboard");
    await probe.notify("sensor:reading", { probe: "four-3", value: 812 });
    await probe.notify("sensor:reading", { probe: "four-3", value: "chaud" });
    await flush();
    expect(screen.messages("sensor:dashboard")).toEqual([
      { probe: "four-3", value: 812 },
    ]);
  });

  it("un écran ne pousse rien, un compte sans le rôle ne lit rien", async () => {
    const screen = await connect("screen", { roles: ["ROLE_SUPERVISOR"] });
    const visitor = await connect("visitor", { roles: ["ROLE_USER"] });
    await screen.subscribe("sensor:dashboard");
    await screen.notify("sensor:reading", { probe: "forged", value: 0 });
    await visitor.subscribe("sensor:dashboard");
    await flush();
    expect(screen.messages("sensor:dashboard")).toHaveLength(0);
    expect(visitor.denials().map((d) => d.channel)).toContain(
      "sensor:dashboard",
    );
  });
});
