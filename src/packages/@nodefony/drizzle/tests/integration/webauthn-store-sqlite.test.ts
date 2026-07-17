import { runWebAuthnStoreContract } from "./webauthn-store-contract";

/**
 * Contrat `IWebAuthnCredentialStore` — dialecte **sqlite** (MÊME suite que
 * postgres/mysql). Tourne toujours (`:memory:`, aucune infra).
 */
describe("DrizzleWebAuthnCredentialStore — contrat (sqlite)", () => {
  runWebAuthnStoreContract({
    dialect: "sqlite",
    connector: "wac_sqlite",
    connection: { filename: ":memory:" },
  });
});
