import { runDrizzleUserPagination } from "./user-pagination-contract";

/**
 * Le **banc de contrat unique** de pagination utilisateur (`@nodefony/user`),
 * déroulé sur les TROIS dialectes SQL depuis UN SEUL fichier (pas un par dialecte) :
 * - **sqlite** (`:memory:`) — toujours exécuté ;
 * - **postgres** / **mysql** — gatés par `NF_PG_URL` / `NF_MYSQL_URL` (sinon skip).
 *
 * Un écart de comportement entre dialectes = un bug du framework, par construction.
 */
const PG_URL = process.env.NF_PG_URL;
const MYSQL_URL = process.env.NF_MYSQL_URL;

runDrizzleUserPagination({
  label: "DrizzleUserRepository — pagination (SQLite)",
  ormName: "user_pagination_sqlite",
  config: { filename: ":memory:" },
});

runDrizzleUserPagination({
  label: "DrizzleUserRepository — pagination e2e Postgres",
  ormName: "user_pagination_pg",
  config: { dialect: "postgres", url: PG_URL ?? "" },
  dialect: "postgres",
  skip: !PG_URL,
});

runDrizzleUserPagination({
  label: "DrizzleUserRepository — pagination e2e MySQL",
  ormName: "user_pagination_mysql",
  config: { dialect: "mysql", url: MYSQL_URL ?? "" },
  dialect: "mysql",
  skip: !MYSQL_URL,
});
