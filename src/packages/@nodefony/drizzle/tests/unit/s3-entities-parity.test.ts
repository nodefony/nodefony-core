import assert from "node:assert/strict";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { getTableConfig as getPgTableConfig } from "drizzle-orm/pg-core";
import type { PgTable } from "drizzle-orm/pg-core";
import {
  createAuditEventTable,
  auditEventTable,
} from "../../nodefony/entity/auditEventEntity";
import {
  createWebhookEndpointTable,
  webhookEndpointTable,
} from "../../nodefony/entity/webhookEndpointEntity";
import type { FrameworkTableFactory } from "../../nodefony/entity/colKit";

/**
 * Parité multi-dialecte des entités S3 (audit_event / webhook_endpoint) —
 * même invariant que S2 : **mêmes NOMS de colonnes** sur sqlite et postgres
 * (stores dialect-agnostiques), divergences de TYPE confinées au colKit,
 * contraintes (PK / NOT NULL) identiques.
 *
 * Chaque assert est ancré sur un besoin RÉEL d'un store : une colonne renommée
 * ou une contrainte perdue ici = un store qui casse en silence sur PG.
 */

interface ColView {
  name: string;
  sqlType: string;
  primary: boolean;
  notNull: boolean;
  isUnique: boolean;
}

function sqliteView(table: SQLiteTable): Map<string, ColView> {
  const { columns } = getTableConfig(table);
  return new Map(
    columns.map((c) => [
      c.name,
      {
        name: c.name,
        sqlType: c.getSQLType(),
        primary: c.primary,
        notNull: c.notNull,
        isUnique: c.isUnique,
      },
    ]),
  );
}

function pgView(table: PgTable): Map<string, ColView> {
  const { columns } = getPgTableConfig(table);
  return new Map(
    columns.map((c) => [
      c.name,
      {
        name: c.name,
        sqlType: c.getSQLType(),
        primary: c.primary,
        notNull: c.notNull,
        isUnique: c.isUnique,
      },
    ]),
  );
}

/** Parité structurelle générique : noms + PK + NOT NULL + UNIQUE. */
function assertParity(factory: FrameworkTableFactory, label: string): void {
  const sqlite = sqliteView(factory("sqlite"));
  const pg = pgView(factory("postgres"));
  assert.deepEqual(
    [...sqlite.keys()].sort(),
    [...pg.keys()].sort(),
    `${label}: mêmes noms de colonnes sur les deux dialectes`,
  );
  for (const [name, s] of sqlite) {
    const p = pg.get(name);
    assert.ok(p, `${label}.${name} absente en PG`);
    assert.equal(p.primary, s.primary, `${label}.${name}: parité PK`);
    assert.equal(p.notNull, s.notNull, `${label}.${name}: parité NOT NULL`);
    assert.equal(p.isUnique, s.isUnique, `${label}.${name}: parité UNIQUE`);
  }
}

describe("S3 multi-dialecte — parité des entités (colKit)", () => {
  it("audit_event : parité + jsonb flags/metadata + ts bigint PG + index console", () => {
    assertParity(createAuditEventTable, "audit_event");
    const pg = pgView(createAuditEventTable("postgres"));
    assert.equal(pg.get("id")?.primary, true);
    assert.equal(
      pg.get("ts")?.sqlType,
      "bigint",
      "epoch ms = bigint (integer PG 32-bit déborde)",
    );
    assert.equal(pg.get("ts")?.notNull, true);
    assert.equal(pg.get("flags")?.sqlType, "jsonb");
    assert.equal(pg.get("metadata")?.sqlType, "jsonb");
    assert.equal(pg.get("actor")?.notNull, false, "contexte nullable");
    // Index de la console d'audit (lus par drizzle-kit) sur les DEUX variantes.
    const expected = [
      "audit_event_actor_idx",
      "audit_event_category_idx",
      "audit_event_requestId_idx",
      "audit_event_ts_idx",
    ];
    const sqliteIx = getTableConfig(createAuditEventTable("sqlite"))
      .indexes.map((ix) => ix.config.name)
      .sort();
    const pgIx = getPgTableConfig(createAuditEventTable("postgres"))
      .indexes.map((ix) => ix.config.name)
      .sort();
    assert.deepEqual(sqliteIx, expected);
    assert.deepEqual(pgIx, expected);
  });

  it("webhook_endpoint : parité + jsonb events/metadata + boolean enabled + epochMs bigint", () => {
    assertParity(createWebhookEndpointTable, "webhook_endpoint");
    const pg = pgView(createWebhookEndpointTable("postgres"));
    assert.equal(pg.get("id")?.primary, true);
    assert.equal(pg.get("url")?.notNull, true);
    assert.equal(pg.get("secretEnc")?.notNull, true, "secret chiffré au repos");
    assert.equal(pg.get("events")?.sqlType, "jsonb");
    assert.equal(pg.get("metadata")?.sqlType, "jsonb");
    assert.equal(pg.get("enabled")?.sqlType, "boolean");
    assert.equal(pg.get("enabled")?.notNull, true);
    // Cycle de vie + télémétrie en epoch ms → bigint.
    for (const col of ["createdAt", "updatedAt", "lastDeliveryAt"]) {
      assert.equal(pg.get(col)?.sqlType, "bigint", `webhook_endpoint.${col}`);
    }
    // Compteurs bornés (code HTTP, échecs consécutifs) = int 32-bit suffisant.
    assert.equal(pg.get("lastDeliveryStatus")?.sqlType, "integer");
    assert.equal(pg.get("failureCount")?.sqlType, "integer");
    assert.equal(pg.get("failureCount")?.notNull, true);
  });

  it("mémoïsation : les exports statiques SONT la variante sqlite des factories", () => {
    assert.equal(auditEventTable, createAuditEventTable("sqlite"));
    assert.equal(webhookEndpointTable, createWebhookEndpointTable("sqlite"));
    // Une factory rappelée rend LA même instance (registre/DDL/stores alignés).
    assert.equal(
      createAuditEventTable("postgres"),
      createAuditEventTable("postgres"),
    );
  });

  it("mysql : erreur actionnable sur les factories S3 (S4 non livré)", () => {
    for (const factory of [createAuditEventTable, createWebhookEndpointTable]) {
      assert.throws(() => factory("mysql"), /mysql on the roadmap/);
    }
  });
});
