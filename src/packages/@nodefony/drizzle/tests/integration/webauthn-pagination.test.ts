import { runDrizzleWebAuthnPagination } from "./webauthn-pagination-contract";

/**
 * Le banc de contrat unique du listing des passkeys (`@nodefony/security`),
 * déroulé sur les TROIS dialectes SQL depuis UN SEUL fichier — sqlite toujours,
 * postgres/mysql gatés par `NF_PG_URL` / `NF_MYSQL_URL`.
 */
const PG_URL = process.env.NF_PG_URL;
const MYSQL_URL = process.env.NF_MYSQL_URL;

runDrizzleWebAuthnPagination({
  label: "DrizzleWebAuthnCredentialStore — pagination (SQLite)",
  connector: "webauthn_pagination_sqlite",
  config: { filename: ":memory:" },
});

runDrizzleWebAuthnPagination({
  label: "DrizzleWebAuthnCredentialStore — pagination e2e Postgres",
  connector: "webauthn_pagination_pg",
  config: { dialect: "postgres", url: PG_URL ?? "" },
  dialect: "postgres",
  skip: !PG_URL,
});

runDrizzleWebAuthnPagination({
  label: "DrizzleWebAuthnCredentialStore — pagination e2e MySQL",
  connector: "webauthn_pagination_mysql",
  config: { dialect: "mysql", url: MYSQL_URL ?? "" },
  dialect: "mysql",
  skip: !MYSQL_URL,
});
