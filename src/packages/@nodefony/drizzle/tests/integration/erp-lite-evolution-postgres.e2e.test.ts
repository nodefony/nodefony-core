import { runErpLiteEvolution } from "./erp-lite-evolution-contract";

/**
 * Banc d'évolution erp-lite v1 → v2 — PostgreSQL réel.
 *
 * GATE : ne tourne que si `NF_PG_URL` est posée (sinon sauté, et compté par le
 * `gateReporter`) — `npm run test:all` la pose.
 */
const PG_URL = process.env.NF_PG_URL;

describe.skipIf(!PG_URL)(
  "corpus erp-lite : v1 → v2 sans perte (postgres)",
  () => {
    runErpLiteEvolution({
      dialect: "postgres",
      connector: "erplite_evo_pg",
      url: PG_URL,
    });
  },
);
