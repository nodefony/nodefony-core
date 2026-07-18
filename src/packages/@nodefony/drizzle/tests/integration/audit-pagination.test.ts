import { runDrizzleAuditPagination } from "./audit-pagination-contract";

/**
 * Le banc de contrat unique du journal d'audit (`@nodefony/security`), déroulé
 * sur les TROIS dialectes SQL depuis UN SEUL fichier — sqlite toujours,
 * postgres/mysql gatés par `NF_PG_URL` / `NF_MYSQL_URL`.
 */
const PG_URL = process.env.NF_PG_URL;
const MYSQL_URL = process.env.NF_MYSQL_URL;

runDrizzleAuditPagination({
  label: "DrizzleAuditStore — pagination (SQLite)",
  connector: "audit_pagination_sqlite",
  config: { filename: ":memory:" },
});

runDrizzleAuditPagination({
  label: "DrizzleAuditStore — pagination e2e Postgres",
  connector: "audit_pagination_pg",
  config: { dialect: "postgres", url: PG_URL ?? "" },
  dialect: "postgres",
  skip: !PG_URL,
});

runDrizzleAuditPagination({
  label: "DrizzleAuditStore — pagination e2e MySQL",
  connector: "audit_pagination_mysql",
  config: { dialect: "mysql", url: MYSQL_URL ?? "" },
  dialect: "mysql",
  skip: !MYSQL_URL,
});
