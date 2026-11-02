import { afterEach, describe, expect, it } from "vitest";
import { getRealtimeHub } from "../../../../index";
import { createRealtimeHarness } from "../../../testing/index";
import type { IRealtimeHarness } from "../../../testing/index";
import { createTestIdentity } from "@nodefony/security/testing";
import { SensorRealtime } from "../../fixtures/use-cases/sensors";
import { notifyInvoicePaid } from "../../fixtures/use-cases/userNotifications";

const open: IRealtimeHarness<SensorRealtime>[] = [];
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** N'importe quel contrôleur temps réel : le canal personnel est fourni par le framework. */
async function connect(
  user: string,
): Promise<IRealtimeHarness<SensorRealtime>> {
  const h = createRealtimeHarness((ctx) => new SensorRealtime(ctx), {
    identity: createTestIdentity({ identifier: user }),
    resetHub: open.length === 0,
  });
  await h.connect();
  open.push(h);
  return h;
}

describe("notification privée — n'atteint que la personne visée", () => {
  afterEach(() => {
    for (const h of open.splice(0)) h.close();
    getRealtimeHub().clear();
  });

  it("alice reçoit, bob non, et personne n'entre sur le canal d'un autre", async () => {
    const alice = await connect("alice");
    const bob = await connect("bob");
    await alice.subscribe("user:alice"); // ce que fait `socket.onUser()`
    await bob.subscribe("user:bob");
    await bob.subscribe("user:alice");
    await flush();
    notifyInvoicePaid("alice", "F-2026-001");
    expect(alice.messages("user:alice")).toEqual([
      { kind: "invoice:paid", invoice: "F-2026-001" },
    ]);
    expect(bob.messages("user:alice")).toHaveLength(0);
    expect(bob.denials()).toMatchObject([
      { channel: "user:alice", reason: "forbidden" },
    ]);
  });
});
