/*
 *   Le terminal de développement, côté superviseur (#536) : un seul écrivain.
 *
 *   La sortie du serveur arrive par des tubes, celle du superviseur aussi ;
 *   `DevTerminal` l'inscrit dans l'historique ET l'affiche sur la surface
 *   `inline` (le rendu de #533), barre d'état redessinée dessous. Les flux sont
 *   factices : on lit exactement ce qui partirait au terminal.
 */

import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { DevTerminal } from "../service/dev/DevTerminal";
import { CLEAR_SCREEN } from "../service/dev/outputMode";
import { eraseBlock, ERASE_LINE } from "../service/dev/statusLine";
import {
  buildStartupView,
  renderStatusBar,
  type IStartupView,
} from "../service/dev/startupScreen";
import { brandMark } from "../cli/brand";
import { resolveBootLinks, type IBootReport } from "../kernel/bootReport";
import {
  onServerEnded,
  relayServerOutput,
  relayedTerminalEnv,
} from "../service/dev/DevSupervisor";
import { DEV_TERMINAL_ENV, parseTerminalVerdict } from "../runtime/isTerminal";

/** Un flux de terminal factice qui enregistre tout ce qui s'y écrit. */
const stream = (columns = 100, rows = 40) => {
  const written: string[] = [];
  return {
    columns,
    rows,
    written,
    write: (chunk: string | Uint8Array): boolean => {
      written.push(String(chunk));
      return true;
    },
  };
};

const servers = [
  {
    type: "http",
    scheme: "http",
    port: 5151,
    address: "127.0.0.1",
    url: "http://127.0.0.1:5151",
  },
];

/** Un bilan minimal de serveur prêt. */
const view = (): IStartupView =>
  buildStartupView(
    {
      durationMs: 1200,
      modulesLoaded: ["a"],
      manifestEntries: 1,
      modulesSkipped: [],
      modulesGated: [],
      warnings: 0,
      errors: 0,
      criticals: null,
      serversExpected: true,
      serversListening: servers,
      healthy: true,
      open: resolveBootLinks(servers, []),
      notices: [],
    } as IBootReport,
    {
      version: "10.0.0",
      environment: "development",
      root: "/app",
      frontend: null,
      data: [],
      processes: null,
      firewall: null,
      supervised: true,
      inspector: null,
    },
  );

const ctx = { project: "mon-app", readyAt: "16:48", reloads: 0 };
const mark = brandMark("unicode", false);

const make = () => {
  const out = stream();
  const err = stream();
  const terminal = new DevTerminal({
    stdout: out,
    stderr: err,
    color: false,
    charset: "unicode",
    mark,
  });
  const bar = renderStatusBar(
    view(),
    ctx,
    { color: false, columns: 100, rows: 40, charset: "unicode" },
    mark,
  ).join("\n");
  return { out, err, terminal, bar };
};

describe("DevTerminal — un seul écrivain (#536)", () => {
  it("inscrit ET affiche la sortie du serveur, couleurs gardées", () => {
    const { out, terminal } = make();
    terminal.ingest("server", "out", Buffer.from("\x1b[32mprêt\x1b[0m\n"));
    expect(out.written).to.deep.equal(["\x1b[32mprêt\x1b[0m\n"]);
    expect(terminal.since(0).map((e) => [e.source, e.text])).to.deep.equal([
      ["server", "\x1b[32mprêt\x1b[0m"],
    ]);
  });

  it("la barre suit le bilan : effacée avant chaque ligne, redessinée dessous", () => {
    const { out, terminal, bar } = make();
    terminal.setStatus(view(), ctx, "ready");
    terminal.ingest("server", "out", "GET / 200\n");
    terminal.ingest("supervisor", "out", "[dev] ↻ changement\n");
    const height = bar.split("\n").length;
    expect(out.written).to.deep.equal([
      bar,
      eraseBlock(height),
      "GET / 200\n",
      bar,
      eraseBlock(height),
      "[dev] ↻ changement\n",
      bar,
    ]);
  });

  it("serveur qui redémarre : la barre disparaît, revient avec le bilan suivant", () => {
    const { out, terminal, bar } = make();
    terminal.setStatus(view(), ctx, "ready");
    terminal.setPhase("restarting");
    terminal.ingest("server", "out", "boot\n");
    expect(out.written.slice(1)).to.deep.equal([
      eraseBlock(bar.split("\n").length),
      "boot\n",
    ]);
    terminal.setStatus(view(), ctx, "ready");
    expect(out.written.at(-1)).to.equal(bar);
  });

  it("la sortie d'erreur efface aussi la barre (sur la sortie standard) avant d'écrire", () => {
    const { out, err, terminal, bar } = make();
    terminal.setStatus(view(), ctx, "ready");
    terminal.ingest("server", "err", "Error: boom\n");
    expect(out.written).to.deep.equal([
      bar,
      eraseBlock(bar.split("\n").length),
      bar,
    ]);
    expect(err.written).to.deep.equal(["Error: boom\n"]);
  });

  it("ESC[2J garde son sens (page propre) ; un déplacement de curseur est retiré", () => {
    const { out, terminal } = make();
    terminal.ingest("server", "out", `${CLEAR_SCREEN}en-tête\n\x1b[5Agarde\n`);
    expect(out.written).to.deep.equal([CLEAR_SCREEN, "en-tête\ngarde\n"]);
    expect(terminal.since(0).map((e) => e.text)).to.deep.equal([
      "en-tête",
      "garde",
    ]);
  });

  it("le retour en colonne 1 de readline (ESC[1G) devient \\r : le spinner réécrit sa ligne", () => {
    const { out, terminal } = make();
    terminal.ingest("server", "out", "\x1b[2K\x1b[1G⠋ boot…");
    terminal.ingest("server", "out", "\x1b[2K\x1b[1G⠙ boot…");
    terminal.ingest("server", "out", "\x1b[2K\x1b[1G✓ boot\n");
    expect(out.written.join("")).to.equal(
      "\x1b[2K\r⠋ boot…\x1b[2K\r⠙ boot…\x1b[2K\r✓ boot\n",
    );
    // L'historique ne garde que la dernière image de la ligne.
    expect(terminal.since(0).map((e) => e.text)).to.deep.equal(["✓ boot"]);
  });

  it("une séquence ou un caractère coupés entre deux paquets attendent la suite", () => {
    const { out, terminal } = make();
    const e = Buffer.from("é");
    terminal.ingest("server", "out", Buffer.from("\x1b[3"));
    terminal.ingest(
      "server",
      "out",
      Buffer.concat([Buffer.from("1mr"), e.subarray(0, 1)]),
    );
    terminal.ingest(
      "server",
      "out",
      Buffer.concat([e.subarray(1), Buffer.from("\n")]),
    );
    expect(out.written.join("")).to.equal("\x1b[31mré\n");
    expect(terminal.since(0).map((x) => x.text)).to.deep.equal(["\x1b[31mré"]);
  });

  it("le spinner du superviseur : une seule entrée d'historique, la ligne finale", () => {
    const { terminal } = make();
    terminal.ingest("supervisor", "out", `${ERASE_LINE}[dev] ⠋ build…`);
    terminal.ingest("supervisor", "out", `${ERASE_LINE}[dev] ⠙ build…`);
    terminal.ingest("supervisor", "out", `${ERASE_LINE}[dev] ✓ build OK\n`);
    expect(terminal.since(0).map((x) => x.text)).to.deep.equal([
      "\x1b[2K[dev] ✓ build OK",
    ]);
  });

  it("flush : la dernière ligne sans fin d'un serveur arrêté entre dans l'historique", () => {
    const { terminal } = make();
    terminal.ingest("server", "err", "    at boot (index.js:1:1)");
    terminal.flush("server");
    expect(terminal.since(0).map((x) => x.text)).to.deep.equal([
      "    at boot (index.js:1:1)",
    ]);
  });

  it("close retire la barre une fois et rend les flux ; plus rien ne s'écrit ensuite", () => {
    const { out, terminal, bar } = make();
    const original = out.write;
    terminal.setStatus(view(), ctx, "ready");
    terminal.close();
    terminal.close();
    terminal.ingest("server", "out", "tard\n");
    expect(out.written).to.deep.equal([
      bar,
      eraseBlock(bar.split("\n").length),
    ]);
    expect(out.write).to.equal(original);
  });
});

describe("environnement d'un serveur relayé (#536)", () => {
  it("porte le verdict et la profondeur de couleur du terminal", () => {
    const env = relayedTerminalEnv({}, { columns: 120, rows: 30 }, 24);
    expect(parseTerminalVerdict(env[DEV_TERMINAL_ENV] ?? "")).to.deep.equal({
      input: false,
      columns: 120,
      rows: 30,
    });
    expect(env.FORCE_COLOR).to.equal("3");
  });

  it("respecte NO_COLOR et un FORCE_COLOR déjà posé", () => {
    expect(
      relayedTerminalEnv({ NO_COLOR: "1" }, { columns: 80, rows: 24 }, 24)
        .FORCE_COLOR,
    ).to.equal(undefined);
    expect(
      relayedTerminalEnv({ FORCE_COLOR: "0" }, { columns: 80, rows: 24 }, 24)
        .FORCE_COLOR,
    ).to.equal(undefined);
  });
});

describe("serveur relayé — un vrai processus en tube (#536)", () => {
  /**
   * Un « serveur » relayé comme sous le superviseur. Sa pile est écrite par
   * un petit-enfant qui hérite du tube, APRÈS la sortie du serveur : c'est le
   * cas où `exit` précède la fin des flux — de façon déterministe.
   */
  const crash = (lines: number, lateMs: number, graceMs = 30_000) =>
    new Promise<{ order: string[]; out: string[] }>((resolve) => {
      const out = stream();
      const terminal = new DevTerminal({
        stdout: out,
        color: false,
        charset: "unicode",
        mark,
      });
      const late =
        `setTimeout(() => { const pile = Array.from({ length: ${lines} }, (_, i) => '    at frame' + i + ' (index.js:' + i + ':1)').join('\\n');` +
        "process.stderr.write('Error: boom\\n' + pile + '\\n'); }, " +
        `${lateMs});`;
      const script =
        "process.stdout.write('boot\\n');" +
        "require('node:child_process').spawn(process.execPath, ['-e', " +
        JSON.stringify(late) +
        "], { stdio: ['ignore', 'inherit', 'inherit'] }).unref();" +
        "process.exitCode = 1;";
      const child = spawn(process.execPath, ["-e", script], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      relayServerOutput(child, terminal);
      onServerEnded(
        child,
        (code) => {
          terminal.flush("server");
          terminal.ingest(
            "supervisor",
            "out",
            `[dev] serveur arrêté (code ${code})\n`,
          );
          resolve({
            order: terminal.since(0).map((e) => e.text),
            out: out.written,
          });
        },
        graceMs,
      );
    });

  it("la sortie du serveur passe par le superviseur, et atteint l'écran", async () => {
    const { order, out } = await crash(3, 0);
    expect(out.join("")).to.contain("boot\n");
    expect(order[0]).to.equal("boot");
  }, 30_000);

  it("crash au démarrage : TOUTE la pile s'affiche AVANT le verdict", async () => {
    const lines = 2000;
    const { order } = await crash(lines, 300);
    const verdict = order.findIndex((t) =>
      t.startsWith("[dev] serveur arrêté"),
    );
    expect(verdict).to.equal(order.length - 1);
    expect(order[verdict - 1]).to.equal(
      `    at frame${lines - 1} (index.js:${lines - 1}:1)`,
    );
    expect(order[verdict]).to.equal("[dev] serveur arrêté (code 1)");
  }, 30_000);

  it("un petit-enfant qui garde le tube ne tait pas le verdict : il part après le délai de grâce", async () => {
    const t0 = Date.now();
    // La pile arrive dans 5 s ; le verdict, lui, n'attend que 200 ms après `exit`.
    const { order } = await crash(1, 5_000, 200);
    expect(order.at(-1)).to.equal("[dev] serveur arrêté (code 1)");
    expect(order.some((t) => t.includes("Error: boom"))).to.equal(false);
    expect(Date.now() - t0).to.be.below(4_000);
  }, 30_000);
});
