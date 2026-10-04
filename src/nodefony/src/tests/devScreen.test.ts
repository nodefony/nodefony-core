/*
 *   L'ÉCRAN de `nodefony development`, jugé tel qu'un humain le voit.
 *
 *   Ce que voit l'utilisateur n'est pas ce qu'écrit le processus : c'est ce
 *   qu'un TERMINAL fait de ces octets — effacements, retours chariot, barre
 *   d'état redessinée en bas. Les bancs en tube (`devTerminal.test.ts`,
 *   `terminalVerdict.test.ts`) jugent les octets ; celui-ci juge l'écran RENDU.
 *
 *   Deux pièces, aucune dépendance native :
 *   - le pseudo-terminal vient de la commande système `script` (Linux et macOS) :
 *     Node n'en a pas sans module natif, et Windows n'en a pas au sens POSIX ;
 *   - l'écran est rendu par `@xterm/headless`, le moteur de xterm.js — un
 *     émulateur écrit ici jugerait l'écran selon NOTRE lecture des séquences,
 *     c'est-à-dire le test complaisant par construction.
 *
 *   La capacité se CONSTATE (`script` présent, saveur util-linux ou BSD) ; une
 *   plateforme qui ne l'a pas l'énonce par `NF_GATES_ALLOW=pty` — l'attente
 *   vit dans `vitest.config.ts`, gardée par la preuve « sous pseudo-terminal ».
 */

import assert from "node:assert";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { connect } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import xterm from "@xterm/headless";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORE_ROOT = path.resolve(HERE, "../..");
const REPO_ROOT = path.resolve(CORE_ROOT, "../..");
const BIN = path.join(CORE_ROOT, "bin", "nodefony");
const RUN_BOOT = process.env.NF_RUN_CLI_BOOT === "1";

const COLS = 120;
const ROWS = 40;
const HTTP_PORT = 5151;
/** Boot réel de l'app du dépôt, trois Vite compris — large, comme le filet CLI. */
const READY_TIMEOUT_MS = Number(process.env.NF_CLI_READY_TIMEOUT_MS) || 150_000;
/** Libellé de la barre d'état prête (`startupScreen.ts`). */
const BAR = "ctrl+c arrêter";
const BAR_RE = /ctrl\+c arrêter/;
/** Préfixe du code de sortie de `script`, écrit par l'enveloppe `sh`. */
const EXIT_MARK = "__NF_SCRIPT_EXIT__";

/** Les deux grammaires de `script`, constatées — jamais déduites du système. */
type ScriptFlavor = "util-linux" | "bsd";

/**
 * Constate la présence de `script` et sa grammaire.
 *
 * @returns la saveur, ou `null` quand la machine n'a pas l'outil.
 */
function scriptFlavor(): ScriptFlavor | null {
  const r = spawnSync("script", ["--version"], { encoding: "utf8" });
  if (r.error) return null;
  // `cat` porte l'entrée (cf {@link startPty}) : sans lui, pas de pilotage.
  if (spawnSync("cat", ["/dev/null"]).error) return null;
  return `${r.stdout}${r.stderr}`.includes("util-linux") ? "util-linux" : "bsd";
}

const FLAVOR = RUN_BOOT ? scriptFlavor() : null;

/** Citation POSIX d'un argument (chemins avec espaces). */
const quote = (s: string): string => `'${s.replaceAll("'", `'\\''`)}'`;

/** Une session pilotée : le processus, l'émulateur, et le texte reçu. */
interface IPtySession {
  child: ChildProcess;
  term: InstanceType<typeof xterm.Terminal>;
  exited: Promise<number | null>;
}

/**
 * Lance `nodefony <args>` sous un pseudo-terminal de COLS×ROWS.
 *
 * La taille est posée par `stty` DANS le terminal, avant l'`exec` : un
 * changement après coup arriverait trop tard pour un processus qui a déjà lu
 * ses dimensions.
 */
function startPty(
  flavor: ScriptFlavor,
  args: string[],
  env: NodeJS.ProcessEnv,
): IPtySession {
  const inner =
    `stty cols ${COLS} rows ${ROWS} && exec ` +
    [process.execPath, BIN, ...args].map(quote).join(" ");
  // `-c` reçoit la commande NUE : l'envelopper d'un `sh -c` ajoute une couche
  // de shell qui reçoit AUSSI le SIGINT du Ctrl+C et rend 130 à la place du
  // code du processus (vécu sous util-linux).
  const scriptCmd =
    flavor === "util-linux"
      ? `script -q -e -c ${quote(inner)} /dev/null`
      : `script -q /dev/null sh -c ${quote(inner)}`;
  // `cat |` : l'entrée de `script` doit être un VRAI tube. Celle que Node
  // fournit est un socket, et `script` (BSD) refuse d'en lire les attributs
  // — sous macOS une FIFO est aussi un socket. Le Ctrl+C écrit sur notre
  // entrée traverse `cat`, puis le terminal, qui signale le premier plan.
  //
  // Le code de `script` remonte par un MARQUEUR sur stderr : `sh` attend `cat`
  // autant que `script`, et `cat` ne finit qu'à la fin de notre entrée. La
  // fermer plus tôt ferait écrire `^D` au terminal, en plein écran jugé.
  const child = spawn(
    "sh",
    ["-c", `cat | { ${scriptCmd}; printf '\\n${EXIT_MARK}%s\\n' "$?" >&2; }`],
    {
      cwd: REPO_ROOT,
      env: { TERM: "xterm-256color", ...env },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const term = new xterm.Terminal({
    cols: COLS,
    rows: ROWS,
    scrollback: 20_000,
    allowProposedApi: true,
  });
  // Octets bruts : l'émulateur recolle lui-même un caractère UTF-8 coupé entre
  // deux paquets — `chunk.toString()` paquet par paquet ne le fait pas.
  child.stdout?.on("data", (chunk: Buffer) => {
    term.write(new Uint8Array(chunk));
  });
  const exited = new Promise<number | null>((resolve) => {
    let err = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      err += chunk.toString("latin1");
      const m = new RegExp(`${EXIT_MARK}(\\d+)`).exec(err);
      if (m) {
        child.stdin?.end();
        resolve(Number(m[1]));
      }
    });
    child.once("close", () => resolve(null));
  });
  return { child, term, exited };
}

/**
 * Attend qu'une ligne de l'écran RENDU (historique compris) porte `pattern` —
 * ce qu'un humain lirait, pas ce que le processus a écrit.
 */
async function waitFor(
  s: IPtySession,
  pattern: RegExp,
  timeoutMs = READY_TIMEOUT_MS,
): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const sc = await snap(s);
    if ([...sc.history, ...sc.screen].some((l) => pattern.test(l))) return;
    if (s.child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  assert.fail(
    `« ${pattern.source} » jamais vu à l'écran\n${screenText(await snap(s))}`,
  );
}

/** L'écran rendu : l'historique défilé, puis les ROWS lignes visibles. */
interface IScreen {
  history: string[];
  screen: string[];
}

/** Fige l'écran, une fois les octets reçus entièrement interprétés. */
async function snap(s: IPtySession): Promise<IScreen> {
  await new Promise<void>((r) => s.term.write("", r));
  const buf = s.term.buffer.active;
  const lines: string[] = [];
  for (let i = 0; i < buf.length; i++) {
    lines.push(buf.getLine(i)?.translateToString(true) ?? "");
  }
  return {
    history: lines.slice(0, buf.baseY),
    screen: lines.slice(buf.baseY, buf.baseY + ROWS),
  };
}

const screenText = (sc: IScreen): string =>
  [...sc.history, "──── écran ────", ...sc.screen].join("\n");

const countLines = (lines: string[], needle: string): number =>
  lines.filter((l) => l.includes(needle)).length;

/**
 * Un reste de séquence imprimé en clair : ce qu'on lit quand une séquence a été
 * coupée entre deux paquets ou mal relayée (`[2K`, `[0m`, octet ESC, `�`).
 */
function garbage(sc: IScreen): string[] {
  return [...sc.history, ...sc.screen].filter((l) =>
    /\x1b|\[[0-9;]+[A-Za-z]|�/.test(l),
  );
}

function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = connect({ port, host: "127.0.0.1" });
    const done = (open: boolean) => {
      sock.destroy();
      resolve(open);
    };
    sock.setTimeout(500, () => done(false));
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
  });
}

/** Ctrl+C TAPÉ : le terminal signale le groupe de premier plan, comme devant un humain. */
async function ctrlC(s: IPtySession): Promise<number | null> {
  s.child.stdin?.write("\x03");
  const timeout = new Promise<"pendu">((r) =>
    setTimeout(() => r("pendu"), 30_000),
  );
  const code = await Promise.race([s.exited, timeout]);
  assert.notStrictEqual(code, "pendu", "Ctrl+C doit arrêter la session");
  return code as number | null;
}

/** Filet : un cas qui échoue en route ne laisse ni serveur ni `script` vivant. */
async function cleanup(s: IPtySession | null): Promise<void> {
  if (s?.child.exitCode === null) {
    s.child.stdin?.end();
    s.child.kill("SIGKILL");
  }
  spawnSync(process.execPath, [BIN, "stop"], { cwd: REPO_ROOT });
}

describe.skipIf(!RUN_BOOT || FLAVOR === null)(
  "écran de développement sous pseudo-terminal",
  () => {
    const flavor = FLAVOR as ScriptFlavor;

    it(
      "prêt, rechargé puis arrêté : une seule barre, en bas, jamais figée dans l'historique",
      async () => {
        let s: IPtySession | null = null;
        try {
          s = startPty(flavor, ["development"], process.env);
          await waitFor(s, BAR_RE);
          // La barre se pose APRÈS le bilan du serveur : quelques instants
          // pour que la sortie des Vite finisse de couler.
          await new Promise((r) => setTimeout(r, 3000));
          const ready = await snap(s);
          const all = [...ready.history, ...ready.screen];
          assert.strictEqual(
            countLines(all, BAR),
            1,
            `une seule barre, nulle part ailleurs\n${screenText(ready)}`,
          );
          assert.ok(
            ready.screen.slice(-8).some((l) => l.includes(BAR)),
            `la barre est en BAS de l'écran\n${screenText(ready)}`,
          );
          // Le bilan est écrit par le SERVEUR : il n'arrive à l'écran que
          // relayé par le superviseur, seul écrivain du terminal.
          assert.ok(
            all.some((l) =>
              l.includes("état machine : nodefony status --json"),
            ),
            `le bilan du serveur passe par le superviseur\n${screenText(ready)}`,
          );
          assert.deepStrictEqual(
            garbage(ready),
            [],
            "aucune séquence imprimée en clair",
          );

          // Rechargement : dates seulement, l'arbre git reste intact.
          const watched = path.join(
            REPO_ROOT,
            "src",
            "modules",
            "test",
            "index.ts",
          );
          const now = new Date();
          fs.utimesSync(watched, now, now);
          await waitFor(s, /rechargement backend/);
          await waitFor(s, /↻ 1/);
          await new Promise((r) => setTimeout(r, 3000));
          const reloaded = await snap(s);
          assert.strictEqual(
            countLines([...reloaded.history, ...reloaded.screen], BAR),
            1,
            `après rechargement, toujours UNE barre\n${screenText(reloaded)}`,
          );
          assert.deepStrictEqual(
            garbage(reloaded),
            [],
            "aucune séquence imprimée en clair",
          );

          const code = await ctrlC(s);
          const final = await snap(s);
          assert.strictEqual(code, 0, `arrêt propre\n${screenText(final)}`);
          assert.strictEqual(
            countLines([...final.history, ...final.screen], BAR),
            0,
            `la barre est effacée à l'arrêt\n${screenText(final)}`,
          );
          assert.strictEqual(
            await isPortOpen(HTTP_PORT),
            false,
            "ports libérés",
          );
        } finally {
          await cleanup(s);
        }
      },
      READY_TIMEOUT_MS * 2 + 60_000,
    );

    it(
      "crash au démarrage : la pile s'affiche AVANT le verdict du superviseur",
      async () => {
        // Le crash vit dans le SEUL serveur (`NF_DEV_CHILD`) : le superviseur
        // charge le même module et ne lève pas.
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nf-devscreen-"));
        let s: IPtySession | null = null;
        try {
          const crash = path.join(dir, "crash.mjs");
          fs.writeFileSync(
            crash,
            'if (process.env.NF_DEV_CHILD === "1") ' +
              'throw new Error("crash volontaire du banc d\'écran");\n',
          );
          s = startPty(flavor, ["development"], {
            ...process.env,
            NODE_OPTIONS:
              `${process.env.NODE_OPTIONS ?? ""} --import="${pathToFileURL(crash).href}"`.trim(),
          });
          await waitFor(s, /abandon/);
          const sc = await snap(s);
          const lines = [...sc.history, ...sc.screen];
          const firstError = lines.findIndex((l) =>
            l.includes("crash volontaire du banc"),
          );
          const firstFrame = lines.findIndex(
            (l, i) => i > firstError && /^\s+at /.test(l),
          );
          const firstVerdict = lines.findIndex((l) =>
            /\[dev\].*crash rapide/.test(l),
          );
          assert.ok(
            firstError >= 0,
            `la cause est à l'écran\n${screenText(sc)}`,
          );
          assert.ok(
            firstVerdict >= 0,
            `le verdict est à l'écran\n${screenText(sc)}`,
          );
          assert.ok(
            firstError < firstVerdict &&
              firstFrame > 0 &&
              firstFrame < firstVerdict,
            `la pile (cause + cadres) précède le verdict\n${screenText(sc)}`,
          );
          assert.deepStrictEqual(
            garbage(sc),
            [],
            "aucune séquence imprimée en clair",
          );
          assert.strictEqual(await ctrlC(s), 0, "arrêt propre après abandon");
        } finally {
          await cleanup(s);
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
      READY_TIMEOUT_MS + 60_000,
    );
  },
);
