/// <reference types="node" />
import { describe, it, beforeEach, afterEach, assert } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Kernel from "../kernel/Kernel";
import Syslog from "../syslog/Syslog";
import {
  getActiveLogDriver,
  setActiveLogDriver,
} from "../syslog/drivers/logDriverRegistry";

// ── E2E câblage config → Kernel → driver de backplane ──────────────────────────
//
// Les drivers eux-mêmes (memory/file/cluster-file/loki/opensearch) sont couverts
// en isolation par LogDriver.test.ts + LogBackplaneHttp.test.ts (query round-trip).
// CE fichier verrouille le maillon qui manquait : que les clés de `config.log`
// (`dir`, `file.path`, `maxStack`, `queryFile.path`, `queryFile.maxScanBytes`)
// atteignent RÉELLEMENT le sink et le driver ACTIF via `Kernel.initializeLog()`.
// Sans lui, ces clés sont déclarables (type + Zod) mais rien ne prouve qu'elles
// sont honorées au boot — un « réglage sans test ».

// Un enregistrement JSONL au format lu par le driver `file` (cf pduToRecord).
const rec = (
  uid: number,
  payload: string,
  timeStamp: number,
  extra: Record<string, unknown> = {},
): string =>
  JSON.stringify({
    uid,
    severity: 6,
    severityName: "INFO",
    moduleName: "TEST",
    msgid: "WIRING",
    msg: "",
    timeStamp,
    pid: process.pid,
    payload,
    ...extra,
  });

describe("Log Backplane — câblage config → Kernel → driver actif", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nf-logwire-"));
  });

  afterEach(() => {
    // Restaure l'état global muté par initializeLog (sink + driver actif),
    // sans vider le registre (le flag `registered` de builtin ne se réarme pas).
    try {
      setActiveLogDriver("memory");
    } catch {
      /* registre pas encore peuplé — sans objet */
    }
    Syslog.setLogSink(null);
    rmSync(dir, { recursive: true, force: true });
  });

  it("`log.maxStack` → la capacité du ring de relecture (bufferCapacity)", () => {
    // `dir` en tmp : en dev, initializeLog MONTE tous les drivers fichier (hot-switch
    // Studio) — sans `dir` le transport `file` écrirait dans le `logs/` du repo.
    const k = new Kernel("development", null, {
      log: { active: true, maxStack: 777, dir },
    });
    k.initializeLog();
    assert.strictEqual(k.syslog?.bufferCapacity, 777);
  });

  it("`log.driver: file` → monte le sink `file` (write plane)", () => {
    const k = new Kernel("development", null, {
      log: {
        active: true,
        driver: "file",
        dir,
        file: { path: join(dir, "app.log") },
      },
    });
    k.initializeLog();
    // Le sink actif est bien le fichier (≠ stdout) — la clé `file.path` est lue
    // par le même `logCfg.file.path` que la résolution symétrique du query plane.
    assert.strictEqual(Syslog.logSinkName, "file");
  });

  it("`log.queryFile.path` → le driver `file` actif relit CE fichier", async () => {
    const jsonl = join(dir, "custom.jsonl");
    writeFileSync(
      jsonl,
      [rec(1, "alpha", 1000), rec(2, "omega", 2000)].join("\n") + "\n",
    );
    const k = new Kernel("development", null, {
      log: {
        active: true,
        driver: "file",
        queryDriver: "file",
        dir, // le sink (write plane) dérive de logDir, pas de queryFile.path
        queryFile: { path: jsonl },
      },
    });
    k.initializeLog();
    const d = getActiveLogDriver();
    assert.ok(d?.capabilities.query, "le driver actif doit être queryable");
    const r = await d!.query!({});
    assert.strictEqual(r.total, 2);
    assert.strictEqual(r.rows[0]!.payload, "omega"); // récent d'abord
  });

  it("`log.dir` → le driver `file` dérive son JSONL sous ce répertoire", async () => {
    // Sans queryFile.path explicite : le chemin est dérivé de log.dir.
    const derived = join(dir, `nodefony-${process.pid}.jsonl`);
    writeFileSync(derived, rec(1, "sous-dir", 1000) + "\n");
    const k = new Kernel("development", null, {
      log: { active: true, driver: "file", queryDriver: "file", dir },
    });
    k.initializeLog();
    const r = await getActiveLogDriver()!.query!({});
    assert.strictEqual(r.total, 1);
    assert.strictEqual(r.rows[0]!.payload, "sous-dir");
  });

  it("`log.queryFile.maxScanBytes` → borne la lecture du driver actif (anti-OOM)", async () => {
    const jsonl = join(dir, "big.jsonl");
    // 6 lignes ; on ne garde en scan que la QUEUE du fichier.
    const lines: string[] = [];
    for (let i = 1; i <= 6; i++) lines.push(rec(i, `l${i}`, i * 1000));
    writeFileSync(jsonl, lines.join("\n") + "\n");
    const oneLine = Buffer.byteLength(lines[5]! + "\n");
    const k = new Kernel("development", null, {
      log: {
        active: true,
        driver: "file",
        queryDriver: "file",
        dir, // sink write plane → tmp (pas le logs/ du repo)
        queryFile: { path: jsonl, maxScanBytes: oneLine + 5 },
      },
    });
    k.initializeLog();
    const r = await getActiveLogDriver()!.query!({});
    // Seule la dernière ligne tient dans la fenêtre → borne honorée.
    assert.strictEqual(r.rows[0]!.payload, "l6");
    assert.ok(r.total <= 2, `attendu ≤ 2 lignes scannées, obtenu ${r.total}`);
  });
});
