import { runSessionStoreContract } from "./session-store-contract";

/**
 * Contrat `SessionStorage` — dialecte **postgres** (MÊME suite que sqlite/mysql) :
 * DDL `jsonb`/`bigint`, `ON CONFLICT … RETURNING`, `touch` en table dérivée,
 * compteur `rowCount`, et pool réel (le write concurrent du banc s'exécute sur
 * des connexions distinctes).
 *
 * GATE : ne tourne que si `NF_PG_URL` est posée (sinon skip silencieux) :
 *   docker compose -f docker/docker-compose.yml --profile postgres up -d postgres
 *   NF_PG_URL=postgres://nodefony:nodefony-dev@127.0.0.1:5432/nodefony npm test
 */
const PG_URL = process.env.NF_PG_URL;

describe.skipIf(!PG_URL)("DrizzleSessionStorage — contrat (postgres)", () => {
  runSessionStoreContract({
    dialect: "postgres",
    connection: { url: PG_URL },
  });
});
