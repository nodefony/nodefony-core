import { runRepositoryContract } from "./repository-contract";

/**
 * Contrat `IRepository` — dialecte **sqlite** (référence, toujours exécuté).
 * La MÊME suite tourne sur postgres/mysql (fichiers e2e frères, gatés infra) :
 * c'est la preuve de parité verbe-par-verbe du chantier multi-dialecte.
 */
describe("DrizzleRepository — contrat (sqlite)", () => {
  runRepositoryContract({
    dialect: "sqlite",
    connector: "contract_sqlite",
    connection: { filename: ":memory:" },
  });
});
