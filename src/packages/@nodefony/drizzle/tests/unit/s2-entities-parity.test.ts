import assert from "node:assert/strict";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { getTableConfig as getPgTableConfig } from "drizzle-orm/pg-core";
import type { PgTable } from "drizzle-orm/pg-core";
import { getTableConfig as getMysqlTableConfig } from "drizzle-orm/mysql-core";
import type { MySqlTable } from "drizzle-orm/mysql-core";
import { createUserTable, userTable } from "../../nodefony/entity/userTable";
import {
  createAccessTokenTable,
  createDeniedJtiTable,
  createSubjectRevocationTable,
  accessTokenTable,
  deniedJtiTable,
  subjectRevocationTable,
} from "../../nodefony/entity/tokenEntity";
import {
  createWebAuthnCredentialTable,
  webAuthnCredentialTable,
} from "../../nodefony/entity/webAuthnCredentialEntity";
import {
  createTotpSecretTable,
  totpSecretTable,
} from "../../nodefony/entity/totpSecretEntity";
import type { FrameworkTableFactory } from "../../nodefony/entity/colKit";

/**
 * Parité multi-dialecte des entités S2 (user / token×3 / webauthn / totp) —
 * l'invariant central du chantier : **mêmes NOMS de colonnes** sur sqlite et
 * postgres (stores et repositories dialect-agnostiques), divergences de TYPE
 * confinées au colKit, contraintes (PK / NOT NULL / UNIQUE) identiques.
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

function mysqlView(table: MySqlTable): Map<string, ColView> {
  const { columns } = getMysqlTableConfig(table);
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

/** Parité structurelle générique : noms + PK + NOT NULL + UNIQUE — 3 dialectes. */
function assertParity(factory: FrameworkTableFactory, label: string): void {
  const sqlite = sqliteView(factory("sqlite"));
  const pg = pgView(factory("postgres"));
  const mysql = mysqlView(factory("mysql"));
  assert.deepEqual(
    [...sqlite.keys()].sort(),
    [...pg.keys()].sort(),
    `${label}: mêmes noms de colonnes sqlite/pg`,
  );
  assert.deepEqual(
    [...sqlite.keys()].sort(),
    [...mysql.keys()].sort(),
    `${label}: mêmes noms de colonnes sqlite/mysql`,
  );
  for (const [name, s] of sqlite) {
    const p = pg.get(name);
    assert.ok(p, `${label}.${name} absente en PG`);
    assert.equal(p.primary, s.primary, `${label}.${name}: parité PK`);
    assert.equal(p.notNull, s.notNull, `${label}.${name}: parité NOT NULL`);
    assert.equal(p.isUnique, s.isUnique, `${label}.${name}: parité UNIQUE`);
    const m = mysql.get(name);
    assert.ok(m, `${label}.${name} absente en MySQL`);
    assert.equal(m.primary, s.primary, `${label}.${name}: parité PK mysql`);
    assert.equal(
      m.notNull,
      s.notNull,
      `${label}.${name}: parité NOT NULL mysql`,
    );
    assert.equal(
      m.isUnique,
      s.isUnique,
      `${label}.${name}: parité UNIQUE mysql`,
    );
  }
}

describe("S2 multi-dialecte — parité des entités (colKit)", () => {
  it("User : parité structurelle + jsonb/timestamptz PG + defaults JS", () => {
    assertParity(createUserTable, "User");
    const pg = pgView(createUserTable("postgres"));
    assert.equal(pg.get("id")?.primary, true);
    assert.equal(pg.get("identifier")?.isUnique, true, "unicité du login");
    assert.equal(pg.get("roles")?.sqlType, "jsonb");
    assert.equal(pg.get("socialProviders")?.sqlType, "jsonb", "requis par @>");
    assert.equal(pg.get("metadata")?.sqlType, "jsonb");
    assert.equal(pg.get("enabled")?.sqlType, "boolean");
    assert.match(
      pg.get("createdAt")?.sqlType ?? "",
      /^timestamp.*with time zone$/,
      "dateMs = timestamptz (exposé Date, comme mode timestamp_ms sqlite)",
    );
  });

  it("access_token : parité + secretHash UNIQUE + epochMs en bigint PG", () => {
    assertParity(createAccessTokenTable, "access_token");
    const pg = pgView(createAccessTokenTable("postgres"));
    assert.equal(pg.get("id")?.primary, true);
    assert.equal(
      pg.get("secretHash")?.isUnique,
      true,
      "unicité du hash = lookup findByHash sûr",
    );
    assert.equal(pg.get("scopes")?.sqlType, "jsonb");
    assert.equal(pg.get("resources")?.sqlType, "jsonb");
    assert.equal(pg.get("resources")?.notNull, false, "nullable (sans slot)");
    // Tout le cycle de vie en epoch ms → bigint (integer PG 32-bit déborde).
    for (const col of ["createdAt", "expiresAt", "lastUsedAt", "revokedAt"]) {
      assert.equal(pg.get(col)?.sqlType, "bigint", `access_token.${col}`);
    }
    // Index perf (lus par drizzle-kit) déclarés sur les deux variantes.
    const sqliteIx = getTableConfig(createAccessTokenTable("sqlite"))
      .indexes.map((ix) => ix.config.name)
      .sort();
    const pgIx = getPgTableConfig(createAccessTokenTable("postgres"))
      .indexes.map((ix) => ix.config.name)
      .sort();
    assert.deepEqual(sqliteIx, [
      "access_token_family_idx",
      "access_token_subjectId_idx",
    ]);
    assert.deepEqual(pgIx, sqliteIx);
  });

  it("denied_jti + subject_revocation : parité + PK naturelles", () => {
    assertParity(createDeniedJtiTable, "denied_jti");
    assertParity(createSubjectRevocationTable, "subject_revocation");
    const denied = pgView(createDeniedJtiTable("postgres"));
    assert.equal(denied.get("jti")?.primary, true);
    assert.equal(denied.get("expiresAt")?.sqlType, "bigint");
    const revocations = pgView(createSubjectRevocationTable("postgres"));
    assert.equal(revocations.get("subjectId")?.primary, true);
    assert.equal(revocations.get("invalidBefore")?.sqlType, "bigint");
  });

  it("webauthn_credential : parité + booléens/flags natifs PG + index userId", () => {
    assertParity(createWebAuthnCredentialTable, "webauthn_credential");
    const pg = pgView(createWebAuthnCredentialTable("postgres"));
    assert.equal(pg.get("id")?.primary, true);
    assert.equal(pg.get("transports")?.sqlType, "jsonb");
    for (const flag of ["backupEligible", "backupState", "uvInitialized"]) {
      assert.equal(pg.get(flag)?.sqlType, "boolean", `flag ${flag}`);
      assert.equal(pg.get(flag)?.notNull, true, `flag ${flag} NOT NULL`);
    }
    assert.equal(
      pg.get("signCount")?.sqlType,
      "integer",
      "compteur anti-clone",
    );
    assert.equal(pg.get("nickname")?.notNull, false, "nickname nullable");
    const pgIx = getPgTableConfig(
      createWebAuthnCredentialTable("postgres"),
    ).indexes.map((ix) => ix.config.name);
    assert.deepEqual(pgIx, ["webauthn_credential_userId_idx"]);
  });

  it("totp_secret : parité + PK userId (1 secret/user) + lastUsedStep int (pas un horodatage)", () => {
    assertParity(createTotpSecretTable, "totp_secret");
    const pg = pgView(createTotpSecretTable("postgres"));
    assert.equal(
      pg.get("userId")?.primary,
      true,
      "clé naturelle 1 secret/user",
    );
    assert.equal(pg.get("recoveryCodes")?.sqlType, "jsonb");
    assert.equal(
      pg.get("lastUsedStep")?.sqlType,
      "integer",
      "tranche T RFC 6238 = int 32-bit suffisant (≠ epochMs)",
    );
    for (const col of ["confirmedAt", "createdAt", "lastUsedAt"]) {
      assert.equal(pg.get(col)?.sqlType, "bigint", `totp_secret.${col}`);
    }
  });

  it("mémoïsation : les exports statiques SONT la variante sqlite des factories", () => {
    assert.equal(userTable, createUserTable("sqlite"));
    assert.equal(accessTokenTable, createAccessTokenTable("sqlite"));
    assert.equal(deniedJtiTable, createDeniedJtiTable("sqlite"));
    assert.equal(
      subjectRevocationTable,
      createSubjectRevocationTable("sqlite"),
    );
    assert.equal(
      webAuthnCredentialTable,
      createWebAuthnCredentialTable("sqlite"),
    );
    assert.equal(totpSecretTable, createTotpSecretTable("sqlite"));
    // Une factory rappelée rend LA même instance (registre/DDL/stores alignés).
    assert.equal(createUserTable("postgres"), createUserTable("postgres"));
  });

  it("mysql (S4) : types natifs — json / bigint / datetime(3) / varchar indexable", () => {
    const user = mysqlView(createUserTable("mysql"));
    assert.equal(user.get("socialProviders")?.sqlType, "json");
    assert.equal(user.get("enabled")?.sqlType, "boolean");
    // dateMs (createdAt/updatedAt exposés `Date`) = datetime(3), pas timestamp
    // (borné 2038, sensible à la timezone de session).
    assert.equal(user.get("createdAt")?.sqlType, "datetime(3)");
    // identifier UNIQUE → varchar(512) (TEXT non indexable InnoDB).
    assert.equal(user.get("identifier")?.sqlType, "varchar(512)");
    const token = mysqlView(createAccessTokenTable("mysql"));
    assert.equal(token.get("expiresAt")?.sqlType, "bigint"); // epoch ms 64-bit
  });
});
