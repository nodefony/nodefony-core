import { runErpLiteEvolution } from "./erp-lite-evolution-contract";

/**
 * Banc d'évolution erp-lite v1 → v2 — MySQL / MariaDB réels.
 *
 * GATE : ne tourne que si `NF_MYSQL_URL` est posée. Elle vise MariaDB 11.4
 * (:3306) par défaut ; `npm run test:all -- --dialects` rejoue le banc sur
 * MySQL Community 8.4 (:3307).
 */
const MYSQL_URL = process.env.NF_MYSQL_URL;

describe.skipIf(!MYSQL_URL)(
  "corpus erp-lite : v1 → v2 sans perte (mysql)",
  () => {
    runErpLiteEvolution({
      dialect: "mysql",
      connector: "erplite_evo_mysql",
      url: MYSQL_URL,
    });
  },
);
