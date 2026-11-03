import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { DrizzleOrm, seedEntityRow } from "@nodefony/drizzle";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import { getRealtimeHub } from "../../../../index";
import { createRealtimeHarness } from "../../../testing/index";
import type { IRealtimeHarness } from "../../../testing/index";
import { createTestIdentity } from "@nodefony/security/testing";
import { UserEntity } from "../../fixtures/entity/User";
import { RoomEntity } from "../../fixtures/entity/Room";
import { RoomMemberEntity } from "../../fixtures/entity/RoomMember";
import { getRoomMemberService } from "../../fixtures/service/RoomMemberService";
import { RoomRealtime, exclude } from "../../fixtures/use-cases/privateRoom";

// Le connecteur de l'APPLICATION : `getRoomMemberService()` le lit sous ce nom.
// Un autre nom (`test-room-member`, celui du test d'entité généré) laisserait
// le service sans base.
const CONNECTOR = "default";
const ENTITIES = [UserEntity, RoomEntity, RoomMemberEntity];

let orm: DrizzleOrm;
let channel = "";
const accounts = new Map<string, string>();

/** L'identifiant en base d'un compte semé. */
function idOf(name: string): string {
  const id = accounts.get(name);
  if (id === undefined) throw new Error(`compte non semé : ${name}`);
  return id;
}

beforeAll(async () => {
  for (const entity of ENTITIES) {
    entityRegistry.register({ ...entity, connector: CONNECTOR });
  }
  orm = new DrizzleOrm(CONNECTOR, { filename: ":memory:" }); // en mémoire, rien à installer
  await orm.connect();
  // Les lignes PARENTES d'abord : `RoomMember` porte deux clés étrangères, et la
  // base refuse un compte ou un salon inventé (« FOREIGN KEY constraint failed »).
  for (const name of ["alice", "bob", "carol", "mallory"]) {
    const id = await seedEntityRow(orm, {
      ...UserEntity,
      connector: CONNECTOR,
    });
    accounts.set(name, String(id));
  }
  const room = String(
    await seedEntityRow(orm, { ...RoomEntity, connector: CONNECTOR }),
  );
  channel = `room:${room}`;
  for (const name of ["alice", "bob", "carol"]) {
    await getRoomMemberService().create({
      room,
      user: idOf(name),
      role: "member",
    });
  }
});

afterAll(async () => {
  await orm.disconnect();
  for (const entity of ENTITIES)
    entityRegistry.unregister(entity.name, CONNECTOR);
  ormRegistry.unregister(CONNECTOR);
});

const open: IRealtimeHarness<RoomRealtime>[] = [];
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Une connexion par compte, identifiée par son identifiant EN BASE. */
async function connect(name: string): Promise<IRealtimeHarness<RoomRealtime>> {
  const h = createRealtimeHarness((ctx) => new RoomRealtime(ctx), {
    identity: createTestIdentity({ identifier: name, id: idOf(name) }),
    resetHub: open.length === 0,
  });
  await h.connect();
  open.push(h);
  return h;
}

const closedOf = (h: IRealtimeHarness<RoomRealtime>): unknown[] =>
  h.received.filter((f) => f.method === "realtime:closed").map((f) => f.params);

describe("salon privé — `allow` lit la base, l'exclusion coupe ET empêche de revenir", () => {
  afterEach(() => {
    for (const h of open.splice(0)) h.close();
    getRealtimeHub().clear();
  });

  it("le membre entre, l'intrus est refusé par le MÊME motif", async () => {
    const bob = await connect("bob");
    const mallory = await connect("mallory");
    await bob.subscribe(channel);
    await mallory.subscribe(channel);
    await flush();
    expect(bob.subscriptions()).toEqual([channel]);
    expect(mallory.denials()).toMatchObject([{ channel, reason: "forbidden" }]);
  });

  it("seul un membre écrit ; l'auteur vient de la connexion, pas du message", async () => {
    const alice = await connect("alice");
    const bob = await connect("bob");
    const mallory = await connect("mallory");
    await alice.subscribe(channel);
    await bob.notify("room:send", {
      room: channel,
      text: "salut",
      author: "x",
    });
    await mallory.notify("room:send", { room: channel, text: "intrus" });
    await flush();
    expect(alice.messages(channel)).toEqual([
      { author: idOf("bob"), text: "salut" },
    ]);
  });

  it("exclu : `evicted` tout de suite, puis refusé à la page rechargée", async () => {
    const carol = await connect("carol");
    await carol.subscribe(channel);
    await flush();
    await exclude(channel, idOf("carol"));
    expect(closedOf(carol)).toEqual([{ channel, reason: "evicted" }]);
    const reloaded = await connect("carol"); // une page rechargée refait `subscribe`
    await reloaded.subscribe(channel);
    await flush();
    expect(reloaded.denials()).toHaveLength(1);
  });
});
