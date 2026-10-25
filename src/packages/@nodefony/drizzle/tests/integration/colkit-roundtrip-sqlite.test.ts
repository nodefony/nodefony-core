import { runColKitRoundtrip } from "./colkit-roundtrip-contract";

/** Banc d'aller-retour du colKit — SQLite (better-sqlite3, en mémoire). */
describe("colKit — aller-retour (sqlite)", () => {
  runColKitRoundtrip({
    dialect: "sqlite",
    connector: "colkit_rt_sqlite",
    connection: { filename: ":memory:" },
    schema: "derived",
  });
  runColKitRoundtrip({
    dialect: "sqlite",
    connector: "colkit_rt_sqlite_mig",
    connection: { filename: ":memory:" },
    schema: "migration",
  });
});
