import { runColKitRoundtrip } from "./colkit-roundtrip-contract";

/**
 * Banc d'aller-retour du colKit — PostgreSQL réel.
 *
 * GATE : ne tourne que si `NF_PG_URL` est posée (sinon sauté, et compté par le
 * `gateReporter`) — `npm run test:all` la pose.
 */
const PG_URL = process.env.NF_PG_URL;

describe.skipIf(!PG_URL)("colKit — aller-retour (postgres)", () => {
  runColKitRoundtrip({
    dialect: "postgres",
    connector: "colkit_rt_pg",
    connection: { url: PG_URL },
    schema: "derived",
  });
  runColKitRoundtrip({
    dialect: "postgres",
    connector: "colkit_rt_pg_mig",
    connection: { url: PG_URL },
    schema: "migration",
  });
});
