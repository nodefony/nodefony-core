import { afterEach, describe, expect, it } from "vitest";
import { getRealtimeHub } from "../../../../index";
import { createRealtimeHarness } from "../../../testing/index";
import type { IRealtimeHarness } from "../../../testing/index";
import { createTestIdentity } from "@nodefony/security/testing";
import { TaskRealtime, owners } from "../../fixtures/use-cases/agentTask";

const open: IRealtimeHarness<TaskRealtime>[] = [];
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

async function connect(user: string): Promise<IRealtimeHarness<TaskRealtime>> {
  const h = createRealtimeHarness((ctx) => new TaskRealtime(ctx), {
    identity: createTestIdentity({ identifier: user }),
    resetHub: open.length === 0,
  });
  await h.connect();
  open.push(h);
  return h;
}

const closedOf = (h: IRealtimeHarness<TaskRealtime>): unknown[] =>
  h.received.filter((f) => f.method === "realtime:closed").map((f) => f.params);

describe("tâche d'agent — le demandeur suit SA progression, puis reçoit `ended`", () => {
  afterEach(() => {
    for (const h of open.splice(0)) h.close();
    owners.clear();
    getRealtimeHub().clear();
  });

  it("progression puis fin, sur un canal que le serveur a nommé", async () => {
    const alice = await connect("alice");
    await alice.notify("task:start");
    for (let i = 0; i < 10; i++) await flush();
    const [task] = alice.subscriptions();
    expect(task).toMatch(/^task:/);
    expect(alice.messages("task:start")).toEqual([{ task }]);
    expect(alice.messages(task ?? "")).toEqual([
      { step: "lecture" },
      { step: "analyse" },
      { step: "rédaction" },
    ]);
    expect(closedOf(alice)).toEqual([{ channel: task, reason: "ended" }]);
  });

  it("un autre compte ne suit pas la tâche d'alice, même en devinant son nom", async () => {
    const alice = await connect("alice");
    await alice.notify("task:start");
    const [task] = alice.subscriptions(); // la tâche tourne encore
    const mallory = await connect("mallory");
    await mallory.subscribe(task ?? "task:devine");
    expect(mallory.denials()).toMatchObject([{ reason: "forbidden" }]);
  });
});
