import { runWebhookStoreContract } from "./webhook-store-contract";

/**
 * Contrat `IWebhookStore` — dialecte **sqlite** (MÊME suite que postgres/mysql).
 * Tourne toujours (`:memory:`, aucune infra).
 */
describe("DrizzleWebhookStore — contrat (sqlite)", () => {
  runWebhookStoreContract({
    dialect: "sqlite",
    connector: "wh_sqlite",
    connection: { filename: ":memory:" },
  });
});
