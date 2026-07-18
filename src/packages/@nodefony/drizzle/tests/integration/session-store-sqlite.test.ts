import { runDrizzleSessionStoreContract } from "./session-store-contract";

/**
 * Contrat `SessionStorage` — dialecte **sqlite** (MÊME suite que postgres/mysql).
 * Tourne toujours (`:memory:`, aucune infra).
 *
 * Les cas propres à sqlite — enregistrement du handler dans le registre, et
 * COMPTAGE des requêtes par verbe (« write seul = 1 UPSERT, 0 SELECT »), qui
 * n'est pas un invariant portable puisque mysql en coûte 2 faute de RETURNING —
 * restent dans `session-storage.test.ts`.
 */
describe("DrizzleSessionStorage — contrat (sqlite)", () => {
  runDrizzleSessionStoreContract({
    dialect: "sqlite",
    connection: { filename: ":memory:" },
  });
});
