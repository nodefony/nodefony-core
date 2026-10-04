/*
 *   Garde de restauration du terminal (#537, ADR-0013 §5 et §9).
 *
 *   Un terminal laissé en écran alternatif, en mode brut ou curseur masqué
 *   survit au programme : la preuve porte donc sur de VRAIS processus, qui
 *   reçoivent de vrais signaux et lèvent de vraies exceptions — `process` d'un
 *   processus de test ne se remet pas à zéro.
 *
 *   Un signal envoyé à soi-même n'atteint ses écouteurs que là où le système
 *   a des signaux : la capacité se CONSTATE (sonde au premier test), elle ne se
 *   déduit pas de la plateforme.
 */

import assert from "node:assert";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, "..");
const root = path.resolve(src, "..", "..", "..");
const tsx = pathToFileURL(
  createRequire(path.join(root, "package.json")).resolve("tsx/esm"),
).href;
const guardUrl = pathToFileURL(
  path.join(src, "runtime", "terminalGuard.ts"),
).href;

interface IRun {
  out: string;
  err: string;
  code: number | null;
  signal: NodeJS.Signals | null;
}

/** Lance un script qui dispose de `guardTerminal` et rend ce qu'il a fait. */
function run(body: string): Promise<IRun> {
  const script = `
    const { guardTerminal } = await import(${JSON.stringify(guardUrl)});
    const say = (text) => process.stdout.write(text + "\\n");
    ${body}
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", tsx, "--input-type=module", "-e", script],
      {
        cwd: root,
        env: { ...process.env, NODE_OPTIONS: "" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ out, err, code, signal }));
  });
}

/** Lignes de la sortie standard, sans la dernière ligne vide. */
const lines = (text: string): string[] => text.split("\n").filter(Boolean);

let signalsReachHandlers: boolean | null = null;

/** Un `SIGINT` envoyé à soi-même atteint-il ses écouteurs ici ? */
async function signalsSupported(): Promise<boolean> {
  if (signalsReachHandlers === null) {
    const probe = await run(`
      process.once("SIGINT", () => { say("reçu"); process.exit(0); });
      process.kill(process.pid, "SIGINT");
      setTimeout(() => {}, 2000);
    `);
    signalsReachHandlers = probe.out.includes("reçu");
  }
  return signalsReachHandlers;
}

describe("garde du terminal — sorties ordinaires", () => {
  it("restaure à la fin normale du processus", async () => {
    const result = await run(`
      guardTerminal(() => say("restauré"));
      say("travail");
    `);
    assert.deepStrictEqual(lines(result.out), ["travail", "restauré"]);
    assert.strictEqual(result.code, 0);
  }, 30_000);

  it("ne restaure plus après le retrait — l'état a été rendu par le chemin ordinaire", async () => {
    const result = await run(`
      const release = guardTerminal(() => say("restauré"));
      release();
      release();
      say("fin");
    `);
    assert.deepStrictEqual(lines(result.out), ["fin"]);
  }, 30_000);

  it("la dernière posée d'abord, et une restauration qui lève n'arrête pas les autres", async () => {
    const result = await run(`
      guardTerminal(() => say("curseur"));
      guardTerminal(() => { throw new Error("cassée"); });
      guardTerminal(() => say("écran"));
    `);
    assert.deepStrictEqual(lines(result.out), ["écran", "curseur"]);
    assert.strictEqual(result.code, 0);
  }, 30_000);

  it("exception non rattrapée : le terminal est rendu AVANT que Node n'imprime la pile", async () => {
    const result = await run(`
      guardTerminal(() => process.stderr.write("restauré\\n"));
      throw new Error("explosion");
    `);
    const restored = result.err.indexOf("restauré");
    const stack = result.err.indexOf("explosion");
    assert.ok(restored !== -1, `restauration absente :\n${result.err}`);
    assert.ok(stack !== -1, `pile absente :\n${result.err}`);
    assert.ok(
      restored < stack,
      `la pile a été imprimée avant la restauration — elle serait peinte dans l'écran alternatif :\n${result.err}`,
    );
    assert.strictEqual(result.code, 1);
  }, 30_000);
});

describe("garde du terminal — signaux", () => {
  it("seule à écouter : restaure, puis RÉÉMET le signal (le shell voit un ^C)", async (ctx) => {
    if (!(await signalsSupported())) ctx.skip();
    const result = await run(`
      guardTerminal(() => say("restauré"));
      process.kill(process.pid, "SIGINT");
      setTimeout(() => say("survécu"), 2000);
    `);
    assert.deepStrictEqual(lines(result.out), ["restauré"]);
    assert.strictEqual(result.signal, "SIGINT");
  }, 30_000);

  // `once` est le cas du superviseur de développement : son écouteur est
  // retiré AVANT d'être appelé. Comptée après lui, la garde se croyait seule.
  for (const order of ["avant", "après"] as const) {
    it(`l'application a son arrêt (\`once\`, posé ${order} la garde) : terminal rendu d'abord, l'application conclut`, async (ctx) => {
      if (!(await signalsSupported())) ctx.skip();
      const app = `process.once("SIGTERM", () => {
        say("arrêt applicatif");
        setTimeout(() => process.exit(0), 50);
      });`;
      const guard = `guardTerminal(() => say("restauré"));`;
      const result = await run(`
        ${order === "avant" ? `${app}\n${guard}` : `${guard}\n${app}`}
        process.kill(process.pid, "SIGTERM");
        setTimeout(() => {}, 2000);
      `);
      assert.deepStrictEqual(lines(result.out), [
        "restauré",
        "arrêt applicatif",
      ]);
      assert.strictEqual(result.code, 0, "l'arrêt applicatif a été tué");
    }, 30_000);
  }

  it("DEUX gardes sans arrêt applicatif : le signal n'est pas avalé", async (ctx) => {
    if (!(await signalsSupported())) ctx.skip();
    const result = await run(`
      guardTerminal(() => say("curseur"));
      guardTerminal(() => say("écran"));
      process.kill(process.pid, "SIGINT");
      setTimeout(() => say("survécu"), 2000);
    `);
    assert.deepStrictEqual(lines(result.out), ["écran", "curseur"]);
    assert.strictEqual(result.signal, "SIGINT");
  }, 30_000);

  it("deux COPIES du module partagent le registre (le binaire embarque la sienne)", async (ctx) => {
    if (!(await signalsSupported())) ctx.skip();
    const result = await run(`
      const second = await import(${JSON.stringify(`${guardUrl}?seconde-copie`)});
      guardTerminal(() => say("première"));
      second.guardTerminal(() => say("seconde"));
      process.kill(process.pid, "SIGINT");
      setTimeout(() => say("survécu"), 2000);
    `);
    assert.deepStrictEqual(lines(result.out), ["seconde", "première"]);
    assert.strictEqual(result.signal, "SIGINT");
  }, 30_000);
});
