import { runRepositoryContract } from "./repository-contract";

/**
 * Contrat `IRepository` — dialecte **mysql** (MÊME suite que sqlite/postgres).
 * C'est le dialecte aux chemins les plus divergents (pas de RETURNING → verbes
 * `*One` en SELECT→mutation-bornée-PK→relecture ; `ON DUPLICATE KEY UPDATE` ;
 * sentinel OFFSET) : chaque assertion partagée prouve que la divergence
 * d'implémentation reste INVISIBLE au contrat.
 *
 * GATE : ne tourne que si `NF_MYSQL_URL` est posée (sinon skip silencieux) :
 *   docker compose -f docker/docker-compose.yml --profile mariadb up -d mariadb
 *   NF_MYSQL_URL=mysql://nodefony:nodefony-dev@127.0.0.1:3306/nodefony npm test
 */
const MYSQL_URL = process.env.NF_MYSQL_URL;

describe.skipIf(!MYSQL_URL)("DrizzleRepository — contrat (mysql)", () => {
  runRepositoryContract({
    dialect: "mysql",
    connector: "contract_mysql",
    connection: { url: MYSQL_URL },
  });
});
