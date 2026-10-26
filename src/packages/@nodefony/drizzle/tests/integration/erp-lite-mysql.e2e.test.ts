import { runErpLite } from "./erp-lite-contract";

/**
 * Banc du corpus erp-lite — MySQL / MariaDB réels.
 *
 * GATE : ne tourne que si `NF_MYSQL_URL` est posée. Elle vise MariaDB 11.4
 * (:3306) par défaut ; `npm run test:all -- --dialects` rejoue le banc sur
 * MySQL Community 8.4 (:3307).
 */
const MYSQL_URL = process.env.NF_MYSQL_URL;

describe.skipIf(!MYSQL_URL)("corpus erp-lite (mysql)", () => {
  runErpLite({
    dialect: "mysql",
    connector: "erplite_mysql",
    connection: { url: MYSQL_URL },
    schema: "derived",
  });
  runErpLite({
    dialect: "mysql",
    connector: "erplite_mysql_mig",
    connection: { url: MYSQL_URL },
    schema: "migration",
  });
});
