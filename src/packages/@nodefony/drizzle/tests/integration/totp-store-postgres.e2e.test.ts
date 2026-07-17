import { runTotpStoreContract } from "./totp-store-contract";

/**
 * Contrat `ITotpSecretStore` — dialecte **postgres** (MÊME suite que sqlite/
 * mysql). Traverse ici le DDL `jsonb`/`bigint` et le pool réel (les tests de
 * concurrence du banc s'exécutent sur des connexions distinctes).
 *
 * GATE : ne tourne que si `NF_PG_URL` est posée (sinon skip silencieux) :
 *   docker compose -f docker/docker-compose.yml --profile postgres up -d postgres
 *   NF_PG_URL=postgres://nodefony:nodefony-dev@127.0.0.1:5432/nodefony npm test
 */
const PG_URL = process.env.NF_PG_URL;

describe.skipIf(!PG_URL)("DrizzleTotpSecretStore — contrat (postgres)", () => {
  runTotpStoreContract({
    dialect: "postgres",
    connector: "totp_pg",
    connection: { url: PG_URL },
  });
});
