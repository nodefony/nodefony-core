/*
 *   NODEFONY FRAMEWORK UNIT TEST — MOCHA STYLE
 *
 *   Driver de sink LB.W : FileSink (write async/borné), NULL_LOG_SINK (noop),
 *   Syslog.setLogSink / logSinkName (bascule du sink process-global).
 */
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import Syslog, { NULL_LOG_SINK } from "../syslog/Syslog";
import { FileSink } from "../syslog/sinks/FileSink";

const wait = (ms = 30): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("Log sink driver (LB.W)", () => {
  describe("FileSink", () => {
    let tmpFile: string;
    beforeEach(() => {
      tmpFile = path.join(
        os.tmpdir(),
        `nf-filesink-${Date.now()}-${Math.random().toString(36).slice(2)}.log`,
      );
    });
    afterEach(() => {
      try {
        fs.unlinkSync(tmpFile);
      } catch {
        /* fichier absent — rien à nettoyer */
      }
    });

    it("écrit les lignes en async sur le fichier (FIFO préservé)", async () => {
      const sink = new FileSink({ path: tmpFile });
      sink.writeOut("a\n");
      sink.writeOut("b\n");
      sink.writeOut("c\n");
      await wait();
      sink.close();
      assert.strictEqual(fs.readFileSync(tmpFile, "utf8"), "a\nb\nc\n");
    });

    it("close() flush le pending (rien perdu) + est idempotent", () => {
      const sink = new FileSink({ path: tmpFile });
      sink.writeOut("x\n");
      sink.close(); // flushSync + closeSync
      sink.close(); // idempotent — pas de throw
      assert.ok(fs.readFileSync(tmpFile, "utf8").includes("x\n"));
    });

    it("writeErr (fatal) est DURABLE immédiatement — sync hors buffer, jamais perdu au crash", () => {
      const sink = new FileSink({ path: tmpFile });
      sink.writeErr("FATAL\n");
      // PAS de await ni close : en mode async, writeOut ne serait pas encore drainé,
      // mais writeErr (sévérité ≤ 3) doit être SUR DISQUE tout de suite (durable même
      // si SIGKILL/OOM avant le drain async).
      assert.ok(
        fs.readFileSync(tmpFile, "utf8").includes("FATAL\n"),
        "le fatal doit être écrit en sync immédiat",
      );
      sink.close();
    });

    it("writeErr après un stdout drainé → ordre causal out→err préservé", async () => {
      const sink = new FileSink({ path: tmpFile });
      sink.writeOut("out\n");
      await wait(); // laisse le stdout async se drainer (plus de write en vol)
      sink.writeErr("err\n"); // pending vide → writeSync direct, ordonné après "out"
      sink.close();
      assert.strictEqual(fs.readFileSync(tmpFile, "utf8"), "out\nerr\n");
    });

    it("drop borné quand le buffer sature (jamais OOM, jamais throw)", async () => {
      // maxPendingBytes minuscule : le 1er write part en drain async, les writes
      // suivants du MÊME tick s'accumulent jusqu'au cap → drop. Boucle sync donc
      // déterministe (le callback async ne tourne qu'au tick suivant).
      const sink = new FileSink({ path: tmpFile, maxPendingBytes: 8 });
      for (let i = 0; i < 100; i++) sink.writeOut("0123456789\n");
      assert.ok(sink.dropped > 0, `attendu des drops, reçu ${sink.dropped}`);
      await wait();
      sink.close();
    });

    it("writeOut après close() = noop (pas d'écriture sur fd fermé)", () => {
      const sink = new FileSink({ path: tmpFile });
      sink.close();
      assert.doesNotThrow(() => sink.writeOut("late\n"));
    });
  });

  describe("FileSink (mode sync)", () => {
    let tmpFile: string;
    beforeEach(() => {
      tmpFile = path.join(
        os.tmpdir(),
        `nf-filesink-sync-${Date.now()}-${Math.random().toString(36).slice(2)}.log`,
      );
    });
    afterEach(() => {
      try {
        fs.unlinkSync(tmpFile);
      } catch {
        /* fichier absent */
      }
    });

    it("writeSync direct : contenu présent SANS attente async (FIFO)", () => {
      const sink = new FileSink({ path: tmpFile, sync: true });
      sink.writeOut("a\n");
      sink.writeOut("b\n");
      // Pas de `await` : en mode sync le write atterrit immédiatement sur le fd.
      assert.strictEqual(fs.readFileSync(tmpFile, "utf8"), "a\nb\n");
      sink.close();
    });

    it("writeErr partage le fd (ordre causal) + close idempotent", () => {
      const sink = new FileSink({ path: tmpFile, sync: true });
      sink.writeOut("out\n");
      sink.writeErr("err\n");
      sink.close();
      sink.close(); // idempotent
      assert.strictEqual(fs.readFileSync(tmpFile, "utf8"), "out\nerr\n");
    });

    it("writeOut après close() = noop", () => {
      const sink = new FileSink({ path: tmpFile, sync: true });
      sink.close();
      assert.doesNotThrow(() => sink.writeOut("late\n"));
    });
  });

  describe("NULL_LOG_SINK", () => {
    it("name='null' et toutes les ops sont noop", () => {
      assert.strictEqual(NULL_LOG_SINK.name, "null");
      assert.doesNotThrow(() => {
        NULL_LOG_SINK.writeOut("x");
        NULL_LOG_SINK.writeErr("y");
        NULL_LOG_SINK.flushSync();
        NULL_LOG_SINK.close();
      });
    });
  });

  describe("Syslog.setLogSink / logSinkName", () => {
    afterEach(() => {
      // CRITIQUE : le sink est process-global → reset pour ne pas contaminer les
      // autres suites (et libérer un éventuel fd FileSink ouvert).
      Syslog.setLogSink(null);
    });

    it("défaut = stdout", () => {
      assert.strictEqual(Syslog.logSinkName, "stdout");
    });

    it("bascule vers null puis revient à stdout via setLogSink(null)", () => {
      Syslog.setLogSink(NULL_LOG_SINK);
      assert.strictEqual(Syslog.logSinkName, "null");
      Syslog.setLogSink(null);
      assert.strictEqual(Syslog.logSinkName, "stdout");
    });

    it("bascule vers un FileSink (name='file')", () => {
      const tmp = path.join(os.tmpdir(), `nf-setsink-${Date.now()}.log`);
      Syslog.setLogSink(new FileSink({ path: tmp }));
      assert.strictEqual(Syslog.logSinkName, "file");
      Syslog.setLogSink(null); // close le FileSink (libère le fd)
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* absent */
      }
    });
  });
});
