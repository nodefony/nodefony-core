import { runDrizzleTokenPagination } from "./token-pagination-contract";

/**
 * Le banc de contrat unique de pagination des jetons (`@nodefony/security`),
 * déroulé sur les TROIS dialectes SQL depuis UN SEUL fichier — sqlite toujours,
 * postgres/mysql gatés par `NF_PG_URL` / `NF_MYSQL_URL`.
 */
const PG_URL = process.env.NF_PG_URL;
const MYSQL_URL = process.env.NF_MYSQL_URL;

runDrizzleTokenPagination({
  label: "DrizzleTokenStore — pagination (SQLite)",
  connector: "token_pagination_sqlite",
  config: { filename: ":memory:" },
});

runDrizzleTokenPagination({
  label: "DrizzleTokenStore — pagination e2e Postgres",
  connector: "token_pagination_pg",
  config: { dialect: "postgres", url: PG_URL ?? "" },
  dialect: "postgres",
  skip: !PG_URL,
});

runDrizzleTokenPagination({
  label: "DrizzleTokenStore — pagination e2e MySQL",
  connector: "token_pagination_mysql",
  config: { dialect: "mysql", url: MYSQL_URL ?? "" },
  dialect: "mysql",
  skip: !MYSQL_URL,
});
