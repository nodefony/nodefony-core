import { runDrizzleIdempotencyPagination } from "./idempotency-pagination-contract";

/**
 * Le banc de contrat unique du listing d'idempotence (CORE), déroulé sur les
 * TROIS dialectes SQL depuis UN SEUL fichier — sqlite toujours, postgres/mysql
 * gatés par `NF_PG_URL` / `NF_MYSQL_URL`.
 *
 * Pourquoi les trois : `DrizzleIdempotencyStore` n'était prouvé qu'en sqlite
 * côté LISTING, alors que ses chemins d'écriture divergent fortement par
 * dialecte (pas de `RETURNING` ni de `WHERE` sur l'ODKU en mysql). Un listing
 * qui marche sur un fichier local ne dit rien de la base de production.
 */
const PG_URL = process.env.NF_PG_URL;
const MYSQL_URL = process.env.NF_MYSQL_URL;

runDrizzleIdempotencyPagination({
  label: "DrizzleIdempotencyStore — pagination (SQLite)",
  connector: "idem_pagination_sqlite",
  config: { filename: ":memory:" },
});

runDrizzleIdempotencyPagination({
  label: "DrizzleIdempotencyStore — pagination e2e Postgres",
  connector: "idem_pagination_pg",
  config: { dialect: "postgres", url: PG_URL ?? "" },
  dialect: "postgres",
  skip: !PG_URL,
});

runDrizzleIdempotencyPagination({
  label: "DrizzleIdempotencyStore — pagination e2e MySQL",
  connector: "idem_pagination_mysql",
  config: { dialect: "mysql", url: MYSQL_URL ?? "" },
  dialect: "mysql",
  skip: !MYSQL_URL,
});
