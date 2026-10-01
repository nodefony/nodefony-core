import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { afterEach, describe, it } from "vitest";
import {
  enableWriteAheadLog,
  isSqliteBusy,
} from "../../nodefony/src/sqliteJournal";

// Deux ouvreurs d'une base NEUVE au même instant (l'app et `orm:migrate`, les
// workers d'un cluster) : basculer en WAL exige un verrou exclusif, et SQLite
// rend `SQLITE_BUSY` sans attendre. Vécu sur la forge : `orm:migrate` refusé
// au démarrage de l'application.
describe("mise en WAL — ouvertures concurrentes", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0))
      fs.rmSync(d, { recursive: true, force: true });
  });
  const freshFile = (): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nf-wal-"));
    dirs.push(dir);
    return path.join(dir, "app.db");
  };

  it("une base occupée par un autre lecteur bascule dès qu'il libère", async () => {
    const file = freshFile();
    const holder = new BetterSqlite3(file);
    holder.exec("CREATE TABLE t(x)");
    holder.exec("BEGIN");
    holder.prepare("SELECT count(*) FROM t").get();
    // `timeout: 0` : le conflit se lit TOUT DE SUITE, comme dans l'impasse de
    // deux ouvreurs — c'est le réessai qui doit l'absorber.
    const opener = new BetterSqlite3(file, { timeout: 0 });
    assert.throws(
      () => opener.pragma("journal_mode = WAL"),
      (e: unknown) => isSqliteBusy(e),
      "le décor doit d'abord REPRODUIRE le conflit",
    );
    let attempts = 0;
    await enableWriteAheadLog(opener, {
      sleep: async () => {
        attempts++;
        if (attempts === 2) holder.exec("COMMIT");
      },
    });
    assert.equal(opener.pragma("journal_mode", { simple: true }), "wal");
    assert.ok(attempts >= 2, `réessais : ${attempts}`);
    opener.close();
    holder.close();
  });

  it("déjà en WAL : rien à basculer, même base occupée", async () => {
    const file = freshFile();
    const first = new BetterSqlite3(file);
    first.pragma("journal_mode = WAL");
    first.exec("CREATE TABLE t(x)");
    first.exec("BEGIN IMMEDIATE");
    const second = new BetterSqlite3(file, { timeout: 0 });
    await enableWriteAheadLog(second, {
      sleep: () => Promise.reject(new Error("aucun réessai attendu")),
    });
    assert.equal(second.pragma("journal_mode", { simple: true }), "wal");
    first.exec("COMMIT");
    second.close();
    first.close();
  });

  it("au-delà de l'échéance, le conflit remonte tel quel", async () => {
    let clock = 0;
    const busy = Object.assign(new Error("database is locked"), {
      code: "SQLITE_BUSY",
    });
    await assert.rejects(
      enableWriteAheadLog(
        {
          pragma: () => {
            throw busy;
          },
        },
        {
          deadlineMs: 100,
          now: () => clock,
          sleep: async (ms) => {
            clock += ms;
          },
        },
      ),
      (e: unknown) => e === busy,
    );
  });

  it("une erreur qui n'est pas un conflit n'est jamais réessayée", async () => {
    let calls = 0;
    await assert.rejects(
      enableWriteAheadLog(
        {
          pragma: () => {
            calls++;
            throw Object.assign(new Error("disk I/O"), {
              code: "SQLITE_IOERR",
            });
          },
        },
        { sleep: () => Promise.reject(new Error("aucun réessai attendu")) },
      ),
      /disk I\/O/u,
    );
    assert.equal(calls, 1);
  });
});
