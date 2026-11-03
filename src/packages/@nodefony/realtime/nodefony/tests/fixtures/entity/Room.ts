import { defineEntity } from "@nodefony/orm-core";
import { defineTable } from "@nodefony/drizzle";
import type { RowOf } from "@nodefony/drizzle";
import { Nodefony } from "nodefony";

/**
 * Ce que `npx nodefony create entity Room "name:string"` écrit, réduit à la
 * table et au descripteur : le salon privé de `docs/cas-d-usage.md` y lit ses
 * salons.
 */
export const roomTable = defineTable({
  name: "room",
  columns: {
    id: {
      kind: "uuid",
      primaryKey: true,
      defaultFn: () => Nodefony.generateSortableId(),
    },
    name: { kind: "string", notNull: true },
  },
});

export type RoomRow = RowOf<typeof roomTable.spec>;

export const RoomEntity = defineEntity({
  name: "Room",
  module: "app",
  schema: roomTable,
});
