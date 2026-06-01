/*
 *   Tests d'INTÉGRATION CLI — exécutent le binaire réel `node bin/nodefony <cmd>`.
 *
 *   Complète les tests UNITAIRES de dispatch (CliKernelDispatch.test.ts, classification
 *   sans boot) : ici on spawn le process complet et on observe son comportement de bout
 *   en bout. C'est le FILET qui sécurise le refacto « parse-pur + registry + 1 seul
 *   Kernel » (cf project_cli_module_command_dispatch).
 *
 *   Deux familles :
 *   - commandes TERMINANTES (--help / --version) : process sort seul, rapide → assert
 *     exit code + sortie. Gardées par la présence du `dist/` (le bin importe `nodefony`).
 *   - commandes SERVEUR + typo : bootent l'app réelle → lourdes, gardées par RUN_CLI_BOOT=1.
 *     Le cœur = INVARIANT BOOT-COUNT : `production`/`cluster -w1` ne doivent créer qu'UN
 *     SEUL Kernel par process (avant refacto : 2 → ces asserts sont RED jusqu'à l'étape C).
 *     Observé via NODEFONY_KERNEL_TRACE_FILE (1 ligne par `new Kernel()`).
 */

import assert from "node:assert";
import { spawn, ChildProcess } from "node:child_process";
import { connect } from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "mocha";

const HERE = path.dirname(fileURLToPath(import.meta.url)); // src/nodefony/src/tests
const CORE_ROOT = path.resolve(HERE, "../.."); // src/nodefony
const REPO_ROOT = path.resolve(CORE_ROOT, "../.."); // racine repo (= app dev)
const BIN = path.join(CORE_ROOT, "bin", "nodefony");
const DIST = path.join(CORE_ROOT, "dist", "node", "index.js"); // entrée `import` (cf package.json exports)

const HTTP_PORT = 5151; // port http principal de l'app dev — sert au garde-fou EADDRINUSE
const READY_RE = /Server Listen on/i; // marqueur readiness (server-static.ts)
const RUN_BOOT = process.env.RUN_CLI_BOOT === "1";

/** Résultat d'un spawn d'une commande terminante. */
interface CliResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

/** Spawn `node bin/nodefony <args>` et attend la sortie du process (commandes terminantes). */
function runCli(args: string[], timeoutMs = 30000): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd: REPO_ROOT,
      env: { ...process.env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(`runCli timeout (${timeoutMs}ms) for: ${args.join(" ")}`),
      );
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

/** true si un serveur écoute déjà sur le port (garde-fou conflit pour les tests serveur). */
function isPortOpen(port: number, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = connect(port, "127.0.0.1");
    const done = (open: boolean) => {
      sock.destroy();
      resolve(open);
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(false));
    sock.once("error", () => done(false));
  });
}

/** Compte les lignes non vides du trace file (1 ligne = 1 `new Kernel()`). */
function countKernelBoots(traceFile: string): number {
  if (!fs.existsSync(traceFile)) return 0;
  return fs
    .readFileSync(traceFile, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0).length;
}

/** Tue un child et attend sa sortie (SIGTERM puis SIGKILL de secours). */
function killAndWait(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    const hard = setTimeout(() => child.kill("SIGKILL"), 5000);
    child.once("exit", () => {
      clearTimeout(hard);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

/**
 * Spawn une commande SERVEUR, attend la readiness (regex stdout), compte les `new Kernel()`
 * via le trace file, puis tue le process. Retourne le boot-count observé.
 */
async function spawnServerAndCountBoots(
  args: string[],
  readyTimeoutMs = 45000,
): Promise<{ boots: number; out: string }> {
  const traceFile = path.join(
    os.tmpdir(),
    `nodefony-kernel-trace-${process.pid}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}.log`,
  );
  const child = spawn(process.execPath, [BIN, ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env, NODEFONY_KERNEL_TRACE_FILE: traceFile },
  });
  let out = "";
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(new Error(`readiness timeout — no "${READY_RE}" in:\n${out}`)),
        readyTimeoutMs,
      );
      const onData = (d: Buffer) => {
        out += d.toString();
        if (READY_RE.test(out)) {
          clearTimeout(timer);
          resolve();
        }
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      child.once("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.once("exit", (code, signal) => {
        clearTimeout(timer);
        reject(
          new Error(
            `process exited (code=${code} signal=${signal}) before readiness:\n${out}`,
          ),
        );
      });
    });
    // À la readiness, le(s) Kernel(s) sont tous construits (kernel#2 est créé AVANT son
    // propre boot serveur). Le compte est donc stable et fiable ici.
    const boots = countKernelBoots(traceFile);
    return { boots, out };
  } finally {
    await killAndWait(child);
    try {
      fs.rmSync(traceFile, { force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
}

describe("CLI integration — commandes terminantes (--help / --version)", function () {
  this.timeout(40000);
  this.slow(8000);

  before(function () {
    if (!fs.existsSync(DIST)) {
      this.skip(); // bin importe `nodefony` (dist) → inutile sans build
    }
  });

  it("--help → exit 0 et liste les commandes built-in", async () => {
    const r = await runCli(["--help"]);
    assert.strictEqual(
      r.code,
      0,
      `exit code attendu 0, reçu ${r.code}\n${r.stderr}`,
    );
    const txt = r.stdout + r.stderr;
    for (const name of ["production", "cluster", "build", "development"]) {
      assert.ok(txt.includes(name), `--help doit lister "${name}"\n${txt}`);
    }
  });

  it("--version → exit 0 et imprime un numéro de version", async () => {
    const r = await runCli(["--version"]);
    assert.strictEqual(
      r.code,
      0,
      `exit code attendu 0, reçu ${r.code}\n${r.stderr}`,
    );
    assert.ok(
      /\d+\.\d+\.\d+/.test(r.stdout + r.stderr),
      `version semver attendue\n${r.stdout}${r.stderr}`,
    );
  });
});

describe("CLI integration — boot réel (RUN_CLI_BOOT=1)", function () {
  this.timeout(90000);
  this.slow(20000);

  before(async function () {
    if (!RUN_BOOT) this.skip();
    if (!fs.existsSync(DIST)) this.skip();
    if (await isPortOpen(HTTP_PORT)) {
      // Un serveur tourne déjà (dev) → le child échouerait EADDRINUSE. On skip plutôt
      // que de produire un faux négatif. Stopper le serveur avant de relancer le filet.
      this.skip();
    }
  });

  it("commande inconnue (typo) → exit ≠ 0 et AUCUN serveur démarré", async () => {
    const r = await runCli(["foobar:nope"], 60000);
    assert.notStrictEqual(r.code, 0, "une typo doit échouer (exit ≠ 0)");
    assert.ok(
      !READY_RE.test(r.stdout + r.stderr),
      `une typo ne doit JAMAIS démarrer un serveur (fallback serveur legacy)\n${r.stdout}`,
    );
  });

  it("production --workers 1 → UN SEUL Kernel par process", async () => {
    const { boots, out } = await spawnServerAndCountBoots([
      "production",
      "--workers",
      "1",
    ]);
    assert.strictEqual(
      boots,
      1,
      `production -w1 doit créer 1 seul Kernel, observé ${boots} (double-boot)\n${out.slice(-2000)}`,
    );
  });

  it("cluster --workers 1 → UN SEUL Kernel par process (mono)", async () => {
    const { boots, out } = await spawnServerAndCountBoots([
      "cluster",
      "--workers",
      "1",
    ]);
    assert.strictEqual(
      boots,
      1,
      `cluster -w1 doit créer 1 seul Kernel, observé ${boots} (double-boot)\n${out.slice(-2000)}`,
    );
  });
});
