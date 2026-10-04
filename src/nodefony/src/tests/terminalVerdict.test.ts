/*
 *   Verdict du terminal transmis par le superviseur de développement (#536).
 *
 *   Sous `nodefony development`, le serveur écrit dans un TUBE que le
 *   superviseur relaie au terminal : sans verdict, il se croirait hors
 *   terminal (rendu `plain`, ni couleur, ni largeur). La preuve porte sur un
 *   VRAI processus lancé en `pipe` avec canal IPC — c'est le décor réel, et
 *   `process.env` d'un processus de test ne se remet pas à zéro.
 */

import assert from "node:assert";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  DEV_TERMINAL_ENV,
  encodeTerminalVerdict,
  parseTerminalVerdict,
} from "../runtime/isTerminal";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, "..");
const root = path.resolve(src, "..", "..", "..");
const tsx = pathToFileURL(
  createRequire(path.join(root, "package.json")).resolve("tsx/esm"),
).href;
const url = (rel: string): string =>
  pathToFileURL(path.join(src, ...rel.split("/"))).href;

/** Ce que le processus serveur simulé rapporte. */
interface IReport {
  mode: string;
  color: boolean;
  stdout: boolean;
  stdin: boolean;
  /** Une SECONDE copie du module (le binaire embarque la sienne). */
  secondCopy: boolean;
  size: { columns?: number; rows?: number };
  resized: { columns?: number; rows?: number } | null;
  ownEnv: string | null;
  childEnv: string | null;
}

/**
 * Lance un « serveur » en `pipe` + IPC, comme le superviseur le fera, et
 * rend ce qu'il a constaté de son terminal.
 */
function runServer(verdict: string | undefined): Promise<IReport> {
  const script = `
    const { isTerminal, terminalSize, onTerminalResize } = await import(${JSON.stringify(url("runtime/isTerminal.ts"))});
    const { isLogColorEnabled } = await import(${JSON.stringify(url("syslog/logColor.ts"))});
    const { resolveOutputMode } = await import(${JSON.stringify(url("service/dev/outputMode.ts"))});
    const { spawnSync } = await import("node:child_process");
    const ownEnv = process.env.${DEV_TERMINAL_ENV} ?? null;
    const child = spawnSync(process.execPath, ["-e", "process.stdout.write(process.env.${DEV_TERMINAL_ENV} ?? '')"], { encoding: "utf8" });
    const report = {
      mode: resolveOutputMode(undefined, process.env, isTerminal(process.stdout)),
      color: isLogColorEnabled(),
      stdout: isTerminal(process.stdout),
      stdin: isTerminal(process.stdin),
      secondCopy: (await import(${JSON.stringify(url("runtime/isTerminal.ts") + "?seconde-copie")})).isTerminal(process.stdout),
      size: terminalSize(),
      resized: null,
      ownEnv,
      childEnv: child.stdout === "" ? null : child.stdout,
    };
    if (!report.stdout) {
      process.stdout.write(JSON.stringify(report));
      process.disconnect();
    } else {
      // La porte relâche le canal IPC (\`channel.unref()\`) : un vrai serveur
      // reste en vie par ses sockets d'écoute, ce simulacre n'a RIEN. Sans
      // cette retenue, il sort en 0 avant que le redimensionnement arrive
      // (vécu sur un exécuteur macOS chargé).
      const keepAlive = setTimeout(() => {}, 20_000);
      onTerminalResize((size) => {
        clearTimeout(keepAlive);
        report.resized = size;
        process.stdout.write(JSON.stringify(report));
        process.disconnect();
      });
      process.send({ ready: true });
    }
  `;
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_OPTIONS: "" };
  for (const key of ["FORCE_COLOR", "NO_COLOR", "NF_NO_TTY", "NF_OUTPUT"]) {
    Reflect.deleteProperty(env, key);
  }
  if (verdict === undefined) Reflect.deleteProperty(env, DEV_TERMINAL_ENV);
  else env[DEV_TERMINAL_ENV] = verdict;
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", tsx, "--input-type=module", "-e", script],
      { cwd: root, env, stdio: ["ignore", "pipe", "pipe", "ipc"] },
    );
    let out = "";
    let err = "";
    child.stdout?.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr?.on("data", (d: Buffer) => (err += d.toString()));
    child.on("message", () => {
      child.send({ channel: "nf-dev", type: "resize", columns: 91, rows: 27 });
    });
    // `close` : la fin du processus ET de ses flux — la sortie est entière.
    // Une sortie illisible REJETTE : levée dans ce gestionnaire, l'erreur
    // ne serait qu'une exception non gérée et la promesse pendrait.
    child.once("close", (code) => {
      if (code !== 0) return reject(new Error(`code ${code}\n${err}`));
      try {
        resolve(JSON.parse(out) as IReport);
      } catch {
        reject(new Error(`rapport illisible : ${JSON.stringify(out)}\n${err}`));
      }
    });
  });
}

describe("verdict du terminal — lecture pure", () => {
  it("relit ce que le superviseur encode", () => {
    assert.deepStrictEqual(
      parseTerminalVerdict(encodeTerminalVerdict({ columns: 120, rows: 40 })),
      { input: false, columns: 120, rows: 40 },
    );
  });

  it("ignore un verdict illisible ou aux dimensions absurdes", () => {
    for (const raw of [
      "",
      "1",
      "{",
      '{"columns":0,"rows":10}',
      '{"columns":80}',
      '{"columns":1.5,"rows":10}',
      '{"columns":100000,"rows":10}',
      `{"columns":80,"rows":24,"pad":"${"x".repeat(2000)}"}`,
    ]) {
      assert.strictEqual(parseTerminalVerdict(raw), null, raw);
    }
  });
});

describe("verdict du terminal — serveur sous tube (#536)", () => {
  it(
    "avec verdict : rendu human, couleurs, largeur transmise et relayée, " +
      "verdict absent de l'environnement des enfants",
    async () => {
      const report = await runServer(
        encodeTerminalVerdict({ columns: 132, rows: 43 }),
      );
      assert.strictEqual(report.mode, "human");
      assert.strictEqual(report.color, true);
      assert.strictEqual(report.stdout, true);
      assert.strictEqual(
        report.secondCopy,
        true,
        "une seconde copie du module voit le verdict que la première a retiré de l'environnement",
      );
      assert.strictEqual(
        report.stdin,
        false,
        "le serveur ne lit jamais le clavier",
      );
      assert.deepStrictEqual(report.size, { columns: 132, rows: 43 });
      assert.deepStrictEqual(report.resized, { columns: 91, rows: 27 });
      assert.strictEqual(report.ownEnv, null, "retiré de process.env");
      assert.strictEqual(
        report.childEnv,
        null,
        "un petit-enfant n'en hérite pas",
      );
    },
    30_000,
  );

  it("sans verdict : un tube reste un tube (rendu plain, sans couleur)", async () => {
    const report = await runServer(undefined);
    assert.strictEqual(report.mode, "plain");
    assert.strictEqual(report.color, false);
    assert.strictEqual(report.stdout, false);
    assert.deepStrictEqual(report.size, {});
  }, 30_000);
});
