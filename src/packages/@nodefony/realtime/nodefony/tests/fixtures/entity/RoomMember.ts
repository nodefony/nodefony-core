import { defineEntity } from "@nodefony/orm-core";
import { defineTable } from "@nodefony/drizzle";
import type { RowOf } from "@nodefony/drizzle";
import { Nodefony } from "nodefony";
import { roomTable } from "./Room";
import { userTable } from "./User";

/**
 * Ce que `npx nodefony create entity RoomMember "room:ref:Room" "user:ref:User"
 * "role:enum(member,moderator)" --no-controller` écrit, réduit à la table et au
 * descripteur. Deux VRAIES clés étrangères : la base refuse une appartenance
 * dont le salon ou le compte n'existe pas — c'est ce qu'un test doit amorcer.
 */
export const roomMemberTable = defineTable({
  name: "room_member",
  columns: {
    id: {
      kind: "uuid",
      primaryKey: true,
      defaultFn: () => Nodefony.generateSortableId(),
    },
    room: {
      kind: "ref",
      target: () => roomTable,
      notNull: true,
      onDelete: "restrict",
    },
    user: {
      kind: "ref",
      target: () => userTable,
      notNull: true,
      onDelete: "restrict",
    },
    role: { kind: "enum", values: ["member", "moderator"], notNull: true },
  },
});

export type RoomMemberRow = RowOf<typeof roomMemberTable.spec>;

export const RoomMemberEntity = defineEntity({
  name: "RoomMember",
  module: "app",
  schema: roomMemberTable,
});
