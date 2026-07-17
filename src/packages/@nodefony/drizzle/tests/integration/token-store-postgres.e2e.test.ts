import { runTokenStoreContract } from "./token-store-contract";

/**
 * Contrat `ITokenStore` — dialecte **postgres** (MÊME suite que sqlite/mysql).
 *
 * Spécificités que le banc traverse ici : DDL dérivé en `jsonb`/`bigint`/
 * `timestamptz`, `ON CONFLICT … DO UPDATE … RETURNING`, `GREATEST()` pour `$max`,
 * compteurs `rowCount`, et surtout un POOL réel — c'est le seul backend où les
 * tests de concurrence du banc s'exécutent sur des connexions DISTINCTES (le
 * banc chauffe le pool avant, sinon la course ne se produit pas).
 *
 * GATE : ne tourne que si `NF_PG_URL` est posée (sinon skip silencieux) :
 *   docker compose -f docker/docker-compose.yml --profile postgres up -d postgres
 *   NF_PG_URL=postgres://nodefony:nodefony-dev@127.0.0.1:5432/nodefony npm test
 */
const PG_URL = process.env.NF_PG_URL;

describe.skipIf(!PG_URL)("DrizzleTokenStore — contrat (postgres)", () => {
  runTokenStoreContract({
    dialect: "postgres",
    connector: "tokens_pg",
    connection: { url: PG_URL },
  });
});
