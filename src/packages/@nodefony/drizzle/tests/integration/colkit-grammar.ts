import { randomUUID } from "node:crypto";
import { defineTable, jsonType } from "../../nodefony/entity/colKit";

/**
 * Tables du banc colKit — TOUTE la grammaire, références comprises. Partagées
 * par le banc d'aller-retour et par la génération de sa migration drizzle-kit
 * (qui relit CE fichier : aucun `await` de premier niveau, aucun effet de bord).
 */

export const PARENT_ENTITY = "colkit_rt_parent";
export const VALUE_ENTITY = "colkit_rt_value";

export const PARENT = defineTable({
  name: PARENT_ENTITY,
  columns: {
    id: { kind: "serial", primaryKey: true },
    label: { kind: "string", length: 40, notNull: true },
  },
});

export const VALUE = defineTable({
  name: VALUE_ENTITY,
  columns: {
    id: { kind: "uuid", primaryKey: true, defaultFn: () => randomUUID() },
    title: { kind: "string", length: 120, column: "title_text" },
    code: { kind: "char", length: 2, column: "iso_code" },
    body: { kind: "text" },
    small: { kind: "int" },
    big: { kind: "int64" },
    ratio: { kind: "float" },
    price: { kind: "decimal", precision: 12, scale: 2 },
    live: { kind: "bool" },
    doc: { kind: "json", type: jsonType<Record<string, unknown>>() },
    day: { kind: "date" },
    at: { kind: "datetime", column: "created_at" },
    ref: { kind: "uuid" },
    status: { kind: "enum", values: ["draft", "live"], column: "row_status" },
    parentId: {
      kind: "ref",
      target: () => PARENT,
      onDelete: "cascade",
      column: "parent_id",
    },
    previous: { kind: "ref", target: "self", onDelete: "set null" },
    // Défauts LITTÉRAUX : DEFAULT SQL dans la migration ET défaut côté JS.
    rank: { kind: "int", notNull: true, default: 7, column: "row_rank" },
    active: { kind: "bool", notNull: true, default: true },
    tier: {
      kind: "enum",
      values: ["free", "pro"],
      notNull: true,
      default: "free",
    },
    // Apostrophe ET accents : le DEFAULT SQL doit être échappé, et encodé.
    motto: { kind: "string", length: 40, notNull: true, default: "l'été 🚀" },
    tags: {
      kind: "json",
      type: jsonType<string[]>(),
      notNull: true,
      default: [],
    },
  },
});

export interface IParentRow {
  id: number;
  label: string;
}

/**
 * Ligne vue par le DÉPÔT, volontairement LARGE (`status: string`) : le banc doit
 * pouvoir écrire une valeur que le type de la table refuse, pour mesurer que le
 * SERVEUR la refuse aussi.
 */
export interface IValueRow {
  id: string;
  title: string | null;
  code: string | null;
  body: string | null;
  small: number | null;
  big: number | null;
  ratio: number | null;
  price: string | null;
  live: boolean | null;
  doc: Record<string, unknown> | null;
  day: string | null;
  at: Date | null;
  ref: string | null;
  status: string | null;
  parentId: number | null;
  previous: string | null;
  rank: number;
  active: boolean;
  tier: string;
  motto: string;
  tags: string[];
}
