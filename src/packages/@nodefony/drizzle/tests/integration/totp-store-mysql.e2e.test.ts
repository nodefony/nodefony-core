import { runTotpStoreContract } from "./totp-store-contract";

/**
 * Contrat `ITotpSecretStore` — dialecte **mysql** (MÊME suite que sqlite/
 * postgres). Chemins divergents traversés : `upsert` = `ON DUPLICATE KEY UPDATE`
 * + relecture (pas de RETURNING), `varchar(512)` pour la PK `userId` (TEXT non
 * indexable InnoDB), JSON rendu en string par MariaDB (customType). Couvre MySQL
 * Community ET MariaDB (mêmes e2e, autre port).
 *
 * GATE : ne tourne que si `NF_MYSQL_URL` est posée (sinon skip silencieux) :
 *   docker compose -f docker/docker-compose.yml --profile mariadb up -d mariadb
 *   NF_MYSQL_URL=mysql://nodefony:nodefony-dev@127.0.0.1:3306/nodefony npm test
 */
const MYSQL_URL = process.env.NF_MYSQL_URL;

describe.skipIf(!MYSQL_URL)("DrizzleTotpSecretStore — contrat (mysql)", () => {
  runTotpStoreContract({
    dialect: "mysql",
    connector: "totp_mysql",
    connection: { url: MYSQL_URL },
  });
});
