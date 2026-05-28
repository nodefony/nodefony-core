import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { count, eq, sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { entity, entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { IRepository } from "@nodefony/orm-core";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";
import type { DrizzleDb } from "../../nodefony/src/orm-core/index";

const ORM = "db_join";

// Entités à noms distincts du banc (registre process-global, même run mocha).
interface Member {
  id: string;
  email: string;
  age: number;
}
interface Channel {
  id: string;
  name: string;
  ownerId: string;
}
interface Message {
  id: string;
  channelId: string;
  authorId: string;
  createdAt: number;
}

const memberTable = sqliteTable("Member", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  email: text("email").notNull().unique(),
  age: integer("age").notNull(),
});
const channelTable = sqliteTable("Channel", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  name: text("name").notNull(),
  ownerId: text("ownerId").notNull(),
});
const messageTable = sqliteTable("Message", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  channelId: text("channelId").notNull(),
  authorId: text("authorId").notNull(),
  createdAt: integer("createdAt").notNull(),
});

@entity({ orm: ORM, name: "Member", schema: memberTable })
class MemberEntity {}
@entity({ orm: ORM, name: "Channel", schema: channelTable })
class ChannelEntity {}
@entity({ orm: ORM, name: "Message", schema: messageTable })
class MessageEntity {}

void MemberEntity;
void ChannelEntity;
void MessageEntity;

/** Forme retournée par la requête analytique complexe. */
interface ActiveMemberRow {
  id: string;
  email: string;
  owned_channels: number;
  msg_count: number;
  last_ts: number;
  busy_channels: number;
  rnk: number;
}

describe("Drizzle adapter — jointure très complexe via trappe native (P7.4)", () => {
  let orm: DrizzleOrm;
  let members: IRepository<Member>;
  let channels: IRepository<Channel>;
  let messages: IRepository<Message>;

  let memberA: Member; // age 30, 2 channels, 3 messages
  let memberB: Member; // age 25, 1 channel, 1 message
  let memberC: Member; // age 17 (mineur), rien

  beforeAll(async () => {
    orm = new DrizzleOrm(ORM, { filename: ":memory:" });
    await orm.connect();
    members = orm.getRepository<Member>("Member");
    channels = orm.getRepository<Channel>("Channel");
    messages = orm.getRepository<Message>("Message");

    memberA = await members.create({ email: "a@x.c", age: 30 });
    memberB = await members.create({ email: "b@x.c", age: 25 });
    memberC = await members.create({ email: "c@x.c", age: 17 });

    const ch1 = await channels.create({ name: "ch1", ownerId: memberA.id });
    const ch2 = await channels.create({ name: "ch2", ownerId: memberA.id });
    await channels.create({ name: "ch3", ownerId: memberB.id }); // 0 message

    let ts = 1_000;
    // A : 2 messages dans ch1 + 1 dans ch2 = 3
    await messages.create({
      channelId: ch1.id,
      authorId: memberA.id,
      createdAt: ts++,
    });
    await messages.create({
      channelId: ch1.id,
      authorId: memberA.id,
      createdAt: ts++,
    });
    await messages.create({
      channelId: ch2.id,
      authorId: memberA.id,
      createdAt: ts++,
    });
    // B : 1 message dans ch1 (ch1 atteint 3 messages → "busy")
    await messages.create({
      channelId: ch1.id,
      authorId: memberB.id,
      createdAt: ts++,
    });
  });

  afterAll(async () => {
    await orm.disconnect();
    entityRegistry.unregister("Member");
    entityRegistry.unregister("Channel");
    entityRegistry.unregister("Message");
    ormRegistry.unregister(ORM);
  });

  it("CTE + window (ROW_NUMBER) + sous-requêtes corrélées imbriquées + INNER JOIN", () => {
    const db = orm.getNativeConnection<DrizzleDb>();

    // « Membres actifs (≥18 ans, au moins 1 message), classés par activité » :
    //  - msg_count via CTE d'agrégation,
    //  - owned_channels via sous-requête corrélée,
    //  - busy_channels via sous-requête corrélée à 2 niveaux (channel ayant ≥2 msg),
    //  - rang via fonction fenêtre ROW_NUMBER.
    const rows = db.all(sql`
      WITH msg_stats AS (
        SELECT m."authorId" AS uid,
               COUNT(*)     AS msg_count,
               MAX(m."createdAt") AS last_ts
        FROM "Message" m
        GROUP BY m."authorId"
      )
      SELECT
        u.id    AS id,
        u.email AS email,
        (SELECT COUNT(*) FROM "Channel" c WHERE c."ownerId" = u.id) AS owned_channels,
        ms.msg_count AS msg_count,
        ms.last_ts   AS last_ts,
        (SELECT COUNT(*) FROM "Channel" c2
           WHERE c2."ownerId" = u.id
             AND (SELECT COUNT(*) FROM "Message" mm WHERE mm."channelId" = c2.id) >= 2
        ) AS busy_channels,
        ROW_NUMBER() OVER (ORDER BY ms.msg_count DESC, u.email ASC) AS rnk
      FROM "Member" u
      INNER JOIN msg_stats ms ON ms.uid = u.id
      WHERE u.age >= 18
      ORDER BY rnk
    `) as ActiveMemberRow[];

    // C (mineur, 0 message) exclu → exactement A puis B.
    assert.equal(rows.length, 2);

    const a = rows[0];
    assert.equal(a.id, memberA.id);
    assert.equal(a.rnk, 1);
    assert.equal(a.owned_channels, 2);
    assert.equal(a.msg_count, 3);
    assert.equal(a.busy_channels, 1); // seul ch1 (3 msg) ≥ 2 ; ch2 (1 msg) non
    assert.equal(a.last_ts, 1_002);

    const b = rows[1];
    assert.equal(b.id, memberB.id);
    assert.equal(b.rnk, 2);
    assert.equal(b.owned_channels, 1);
    assert.equal(b.msg_count, 1);
    assert.equal(b.busy_channels, 0); // ch3 a 0 message

    // memberC jamais présent (filtré par âge + absence de message).
    assert.equal(
      rows.find((r) => r.id === memberC.id),
      undefined,
    );
  });

  it("jointure typée (query builder Drizzle) : LEFT JOIN + GROUP BY + COUNT", () => {
    const db = orm.getNativeConnection<DrizzleDb>();

    // Même intention, exprimée avec le builder type-safe de Drizzle.
    const rows = db
      .select({
        email: memberTable.email,
        ownedChannels: count(channelTable.id),
      })
      .from(memberTable)
      .leftJoin(channelTable, eq(channelTable.ownerId, memberTable.id))
      .groupBy(memberTable.id)
      .orderBy(memberTable.email)
      .all() as Array<{ email: string; ownedChannels: number }>;

    assert.equal(rows.length, 3);
    assert.deepEqual(
      rows.map((r) => [r.email, r.ownedChannels]),
      [
        ["a@x.c", 2],
        ["b@x.c", 1],
        ["c@x.c", 0], // LEFT JOIN → 0, pas d'exclusion
      ],
    );
  });
});
