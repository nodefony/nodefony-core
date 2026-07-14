import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { entity, entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { IRepository } from "@nodefony/orm-core";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";

const ORM = "db_load";
const N = 20_000; // volume principal

interface User {
  id: string;
  email: string;
  age: number;
}
interface Room {
  id: string;
  name: string;
  userId: string;
}

const usersTable = sqliteTable("User", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  email: text("email").notNull(),
  age: integer("age").notNull(),
});

const roomsTable = sqliteTable("Room", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  name: text("name").notNull(),
  userId: text("userId").notNull(),
});

@entity({
  connector: ORM,
  name: "User",
  schema: usersTable,
  relations: [{ type: "one-to-many", target: "Room", field: "rooms" }],
})
class UserEntity {}

@entity({ connector: ORM, name: "Room", schema: roomsTable })
class RoomEntity {}

void UserEntity;
void RoomEntity;

/** Heap utilisé (MB) après GC forcé (`--expose-gc`). */
function heapMB(): number {
  if (globalThis.gc) {
    globalThis.gc();
  }
  return process.memoryUsage().heapUsed / 1_048_576;
}

/** Chronomètre un travail async, retourne [résultat, ms]. */
async function timed<R>(work: () => Promise<R>): Promise<[R, number]> {
  const t0 = performance.now();
  const result = await work();
  return [result, performance.now() - t0];
}

function rate(count: number, ms: number): string {
  return `${Math.round((count / ms) * 1000).toLocaleString()} ops/s`;
}

describe("Drizzle adapter — charge / limites / mémoire (P7.4)", () => {
  let orm: DrizzleOrm;
  let users: IRepository<User>;
  let rooms: IRepository<Room>;
  const ids: string[] = [];

  beforeAll(async () => {
    orm = new DrizzleOrm(ORM, { filename: ":memory:" });
    await orm.connect();
    users = orm.getRepository<User>("User");
    rooms = orm.getRepository<Room>("Room");
  });

  afterAll(async () => {
    await orm.disconnect();
    entityRegistry.unregister("User");
    entityRegistry.unregister("Room");
    ormRegistry.unregister(ORM);
  });

  // ── CHARGE — débit d'écriture ─────────────────────────────────────────────
  it(`charge : insert ${N.toLocaleString()} users (1 transaction)`, async () => {
    const heap0 = heapMB();
    const [, ms] = await timed(() =>
      orm.transaction(async (tx) => {
        const txUsers = users.withTransaction(tx);
        for (let i = 0; i < N; i++) {
          const u = await txUsers.create({ email: `u${i}@x.c`, age: i % 100 });
          ids.push(u.id);
        }
      }),
    );
    const heap1 = heapMB();
    console.log(
      `      ↳ insert: ${ms.toFixed(0)}ms (${rate(N, ms)}), heapΔ ${(heap1 - heap0).toFixed(1)}MB`,
    );
    assert.equal(await users.count(), N);
    assert.equal(ids.length, N);
  });

  // ── CHARGE — débit de lecture (scan complet) ──────────────────────────────
  it(`charge : find() scan complet ${N.toLocaleString()} lignes`, async () => {
    const [rows, ms] = await timed(() => users.find());
    console.log(`      ↳ scan: ${ms.toFixed(0)}ms (${rate(N, ms)})`);
    assert.equal(rows.length, N);
  });

  // ── LIMITE — grand $in (5000 ids) ─────────────────────────────────────────
  it("limite : critère $in avec 5 000 ids", async () => {
    const subset = ids.slice(0, 5_000);
    const [rows, ms] = await timed(() => users.find({ id: { $in: subset } }));
    console.log(`      ↳ $in(5000): ${ms.toFixed(0)}ms`);
    assert.equal(rows.length, 5_000);
  });

  // ── LIMITE — balayage paginé complet ──────────────────────────────────────
  it(`limite : pagination ${N.toLocaleString()} lignes (pages de 1000)`, async () => {
    const [total, ms] = await timed(async () => {
      let seen = 0;
      for (let offset = 0; offset < N; offset += 1_000) {
        const page = await users.find(undefined, {
          limit: 1_000,
          offset,
          order: [["age", "ASC"]],
        });
        seen += page.length;
      }
      return seen;
    });
    console.log(`      ↳ pagination ${N / 1000} pages: ${ms.toFixed(0)}ms`);
    assert.equal(total, N);
  });

  // ── CHARGE — opérateurs riches sur gros volume ────────────────────────────
  it("charge : opérateurs riches ($gte/$lt/$nin) sur le volume complet", async () => {
    const [, ms] = await timed(async () => {
      const a = await users.find({ age: { $gte: 50 } });
      const b = await users.find({ age: { $gte: 20, $lt: 30 } });
      const c = await users.count({ age: { $nin: [0, 1, 2] } });
      assert.equal(a.length, (N / 100) * 50);
      assert.equal(b.length, (N / 100) * 10);
      assert.equal(c, N - (N / 100) * 3);
    });
    console.log(`      ↳ 3 requêtes riches: ${ms.toFixed(0)}ms`);
  });

  // ── CHARGE — eager-load à grande échelle ──────────────────────────────────
  it("charge : eager-load 2 000 users × 3 rooms (populate)", async () => {
    const owners = ids.slice(0, 2_000);
    await orm.transaction(async (tx) => {
      const txRooms = rooms.withTransaction(tx);
      for (const userId of owners) {
        await txRooms.create({ name: "a", userId });
        await txRooms.create({ name: "b", userId });
        await txRooms.create({ name: "c", userId });
      }
    });
    const [loaded, ms] = await timed(() =>
      users.find({ id: { $in: owners } }, { relations: ["rooms"] }),
    );
    console.log(
      `      ↳ eager-load 2000 parents (${rooms ? 6000 : 0} enfants): ${ms.toFixed(0)}ms`,
    );
    assert.equal(loaded.length, 2_000);
    assert.equal(loaded[0].rooms?.length, 3);
    assert.equal(await rooms.count(), 6_000);
  });

  // ── MÉMOIRE — fuite sur cycles create/find/delete ─────────────────────────
  it("mémoire : 30 000 cycles create/findOne/delete → heap stable", async () => {
    const cycles = 30_000;
    const heap0 = heapMB();
    for (let i = 0; i < cycles; i++) {
      const u = await users.create({ email: `leak${i}@x.c`, age: 1 });
      await users.findOne({ id: u.id });
      await users.delete({ id: u.id });
    }
    const heap1 = heapMB();
    const delta = heap1 - heap0;
    console.log(
      `      ↳ ${cycles.toLocaleString()} cycles, heapΔ ${delta.toFixed(1)}MB`,
    );
    assert.equal(await users.count(), N); // dataset principal intact
    assert.ok(
      delta < 40,
      `fuite mémoire suspectée : heapΔ ${delta.toFixed(1)}MB (seuil 40MB)`,
    );
  });

  // ── MÉMOIRE — cycles connect/disconnect + registre stable ─────────────────
  it("mémoire : 300 connect/disconnect → heap + ormRegistry stables", async () => {
    const baseSize = ormRegistry.list().length;
    const heap0 = heapMB();
    for (let i = 0; i < 300; i++) {
      const tmp = new DrizzleOrm(`tmp_${i}`, { filename: ":memory:" });
      await tmp.connect();
      assert.equal(tmp.isConnected(), true);
      await tmp.disconnect();
      ormRegistry.unregister(`tmp_${i}`);
    }
    const heap1 = heapMB();
    const delta = heap1 - heap0;
    console.log(
      `      ↳ 300 connexions éphémères, heapΔ ${delta.toFixed(1)}MB`,
    );
    assert.equal(ormRegistry.list().length, baseSize); // pas de fuite de registre
    assert.ok(
      delta < 40,
      `fuite registre/connexion suspectée : heapΔ ${delta.toFixed(1)}MB`,
    );
  });
});
