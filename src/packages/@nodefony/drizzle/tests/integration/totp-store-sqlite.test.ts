import { runTotpStoreContract } from "./totp-store-contract";

/**
 * Contrat `ITotpSecretStore` — dialecte **sqlite** (MÊME suite que postgres/
 * mysql). Tourne toujours (`:memory:`, aucune infra).
 */
describe("DrizzleTotpSecretStore — contrat (sqlite)", () => {
  runTotpStoreContract({
    dialect: "sqlite",
    connector: "totp_sqlite",
    connection: { filename: ":memory:" },
  });
});
