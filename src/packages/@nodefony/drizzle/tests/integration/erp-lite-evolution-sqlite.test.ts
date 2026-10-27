import { runErpLiteEvolution } from "./erp-lite-evolution-contract";

/** Banc d'évolution erp-lite v1 → v2 — SQLite (fichier du décor). */
describe("corpus erp-lite : v1 → v2 sans perte (sqlite)", () => {
  runErpLiteEvolution({ dialect: "sqlite", connector: "erplite_evo_sqlite" });
});
