import { runDrizzleSessionStoreContract } from "./session-store-contract";

/**
 * Contrat `SessionStorage` — dialecte **mysql** (MÊME suite que sqlite/postgres).
 * Chemins divergents traversés : `ON DUPLICATE KEY UPDATE` + relecture (pas de
 * RETURNING → un `write` y coûte 2 requêtes, cf la doc du banc), `touch` en
 * SELECT→UPDATE borné PK, compteur `affectedRows`, JSON rendu en string par
 * MariaDB (customType), `varchar(512)` pour la PK `session_id`.
 * Couvre MySQL Community ET MariaDB (mêmes e2e, autre port).
 *
 * GATE : ne tourne que si `NF_MYSQL_URL` est posée (sinon skip silencieux) :
 *   docker compose -f docker/docker-compose.yml --profile mariadb up -d mariadb
 *   NF_MYSQL_URL=mysql://nodefony:nodefony-dev@127.0.0.1:3306/nodefony npm test
 */
const MYSQL_URL = process.env.NF_MYSQL_URL;

describe.skipIf(!MYSQL_URL)("DrizzleSessionStorage — contrat (mysql)", () => {
  runDrizzleSessionStoreContract({
    dialect: "mysql",
    connection: { url: MYSQL_URL },
  });
});
