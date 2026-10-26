import { runErpLite } from "./erp-lite-contract";

/** Banc du corpus erp-lite — SQLite (better-sqlite3, en mémoire). */
describe("corpus erp-lite (sqlite)", () => {
  runErpLite({
    dialect: "sqlite",
    connector: "erplite_sqlite",
    connection: { filename: ":memory:" },
    schema: "derived",
  });
  runErpLite({
    dialect: "sqlite",
    connector: "erplite_sqlite_mig",
    connection: { filename: ":memory:" },
    schema: "migration",
  });
});
