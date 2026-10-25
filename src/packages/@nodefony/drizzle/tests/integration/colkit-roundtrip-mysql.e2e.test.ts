import { runColKitRoundtrip } from "./colkit-roundtrip-contract";

/**
 * Banc d'aller-retour du colKit — MySQL / MariaDB réels.
 *
 * GATE : ne tourne que si `NF_MYSQL_URL` est posée. Elle vise MariaDB 11.4
 * (:3306) par défaut ; `npm run test:all -- --dialects` rejoue le banc sur
 * MySQL Community 8.4 (:3307).
 */
const MYSQL_URL = process.env.NF_MYSQL_URL;

describe.skipIf(!MYSQL_URL)("colKit — aller-retour (mysql)", () => {
  runColKitRoundtrip({
    dialect: "mysql",
    connector: "colkit_rt_mysql",
    connection: { url: MYSQL_URL },
    schema: "derived",
  });
  runColKitRoundtrip({
    dialect: "mysql",
    connector: "colkit_rt_mysql_mig",
    connection: { url: MYSQL_URL },
    schema: "migration",
  });
});
