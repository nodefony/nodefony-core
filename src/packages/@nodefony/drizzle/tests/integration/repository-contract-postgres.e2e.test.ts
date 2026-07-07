import { runRepositoryContract } from "./repository-contract";

/**
 * Contrat `IRepository` — dialecte **postgres** (MÊME suite que sqlite/mysql).
 *
 * GATE : ne tourne que si `NF_PG_URL` est posée (sinon skip silencieux) :
 *   docker compose -f docker/docker-compose.yml --profile postgres up -d postgres
 *   NF_PG_URL=postgres://nodefony:nodefony-dev@127.0.0.1:5432/nodefony npm test
 */
const PG_URL = process.env.NF_PG_URL;

describe.skipIf(!PG_URL)("DrizzleRepository — contrat (postgres)", () => {
  runRepositoryContract({
    dialect: "postgres",
    ormName: "contract_pg",
    connection: { url: PG_URL },
  });
});
