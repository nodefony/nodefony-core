/*
 *   Le terminal de développement en plein écran (#537, ADR-0013 §2, §4, §9).
 *
 *   Ce que voit le développeur n'est pas ce qu'écrit le superviseur : c'est ce
 *   qu'un TERMINAL fait de ces octets. L'écran est donc rendu par
 *   `@xterm/headless` (le moteur de xterm.js) — un émulateur écrit ici
 *   jugerait l'écran selon notre propre lecture des séquences. Le clavier est
 *   un flux factice : on lui verse les octets qu'enverrait un terminal en mode
 *   brut.
 */

import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";
import xterm from "@xterm/headless";
import { afterEach, describe, expect, it, vi } from "vitest";
import { brandMark } from "../cli/brand";
import {
  DevTerminal,
  probeTerminal,
  type IInputFocus,
} from "../service/dev/DevTerminal";
import {
  mouseCaptureBlocker,
  readDevMouseRequest,
  readDevUiRequest,
} from "../service/dev/outputMode";
import { invertColumns } from "../service/dev/devSelection";
import type { IStartupView } from "../service/dev/startupScreen";
import { TERMINAL_PROBE } from "../service/dev/terminalCapability";

const COLS = 60;
const ROWS = 12;
const ctx = { project: "mon-app", readyAt: "16:48", reloads: 0 };

/** Un flux de terminal factice qui enregistre tout ce qui s'y écrit. */
function output(columns = COLS, rows = ROWS) {
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
}

/** Un clavier factice : mode brut observé, octets versés à la main. */
class FakeInput extends EventEmitter {
  raw = false;
  paused = true;
  setRawMode(mode: boolean): this {
    this.raw = mode;
    return this;
  }
  resume(): this {
    this.paused = false;
    return this;
  }
  pause(): this {
    this.paused = true;
    return this;
  }
  type(bytes: string): void {
    this.emit("data", Buffer.from(bytes));
  }
}

function fullscreen(
  options: {
    synchronized?: boolean;
    columns?: number;
    rows?: number;
    mouse?: boolean;
    copy?: (text: string) => Promise<string>;
  } = {},
) {
  const stdout = output(options.columns, options.rows);
  const input = new FakeInput();
  const quit = vi.fn();
  const terminal = new DevTerminal({
    stdout,
    color: false,
    charset: "unicode",
    mark: brandMark("unicode", false),
    fullscreen: {
      input,
      synchronized: options.synchronized ?? false,
      onQuit: quit,
      ...(options.mouse === undefined ? {} : { mouse: options.mouse }),
      ...(options.copy === undefined ? {} : { copy: options.copy }),
    },
  });
  return { stdout, input, quit, terminal };
}

/** Laisse passer une image (au plus une toutes les 16 ms). */
const nextFrame = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 40));

/** L'écran rendu par un vrai émulateur, ligne à ligne. */
async function screen(
  written: readonly string[],
  cols = COLS,
  rows = ROWS,
): Promise<string[]> {
  const term = new xterm.Terminal({
    cols,
    rows,
    allowProposedApi: true,
  });
  await new Promise<void>((resolve) => term.write(written.join(""), resolve));
  const buf = term.buffer.active;
  const lines: string[] = [];
  for (let i = 0; i < rows; i++) {
    lines.push(buf.getLine(buf.baseY + i)?.translateToString(true) ?? "");
  }
  term.dispose();
  return lines;
}

/**
 * Les cellules en vidéo inverse d'une ligne d'écran, vues par l'émulateur :
 * `#` inversée, `.` normale — sur les `width` premières colonnes.
 */
async function inverseCells(
  written: readonly string[],
  row: number,
  width = 12,
  cols = COLS,
  rows = ROWS,
): Promise<string> {
  const term = new xterm.Terminal({ cols, rows, allowProposedApi: true });
  await new Promise<void>((resolve) => term.write(written.join(""), resolve));
  const buf = term.buffer.active;
  const line = buf.getLine(buf.baseY + row);
  let out = "";
  for (let x = 0; x < width; x++) {
    out += line?.getCell(x)?.isInverse() ? "#" : ".";
  }
  term.dispose();
  return out;
}

/** Une séquence SGR de souris (colonne et ligne depuis 1). */
const press = (col: number, row: number): string => `\x1b[<0;${col};${row}M`;
const drag = (col: number, row: number): string => `\x1b[<32;${col};${row}M`;
const release = (col: number, row: number): string => `\x1b[<0;${col};${row}m`;

const lines = (n: number, from = 1): string =>
  Array.from({ length: n }, (_, i) => `ligne ${i + from}\n`).join("");

afterEach(() => {
  vi.useRealTimers();
});

describe("plein écran — entrée et image", () => {
  it("entre en écran alternatif, défilement alterné et collage, clavier en mode brut", () => {
    const { stdout, input, terminal } = fullscreen();
    const enter = stdout.written[0] ?? "";
    for (const mode of ["1049", "1007", "2004"]) {
      expect(enter).to.include(`\x1b[?${mode}h`);
    }
    // Sans `--mouse`, la souris reste au TERMINAL : capter les clics tuerait
    // la sélection native — copier un message d'erreur, le geste n°1 devant
    // un journal.
    for (const mode of ["1000", "1002", "1003", "1006"]) {
      expect(enter).to.not.include(`\x1b[?${mode}h`);
    }
    expect(input.raw).to.equal(true);
    expect(input.paused).to.equal(false);
    expect(input.listenerCount("data")).to.equal(1);
    expect(terminal.surface).to.equal("fullscreen");
    terminal.close();
  });

  it("--mouse : clics, glisser et SGR captés — jamais tout mouvement ni focus ; 1007 reste posé", () => {
    const { stdout, terminal } = fullscreen({ mouse: true });
    const enter = stdout.written[0] ?? "";
    for (const mode of ["1049", "1007", "2004", "1000", "1002", "1006"]) {
      expect(enter, mode).to.include(`\x1b[?${mode}h`);
    }
    for (const mode of ["1003", "1004"]) {
      expect(enter, mode).to.not.include(`\x1b[?${mode}h`);
    }
    terminal.close();
  });

  it("la sortie coupe TOUS les modes posés à l'entrée, souris comprise", () => {
    for (const mouse of [false, true]) {
      const { stdout, terminal } = fullscreen({ mouse });
      const enter = stdout.written[0] ?? "";
      stdout.written.length = 0;
      terminal.close();
      const leave = stdout.written.join("");
      const posed = [...enter.matchAll(/\x1b\[\?(\d+)h/g)].map((m) => m[1]);
      for (const mode of posed) {
        if (mode === "25") continue; // curseur : masqué à l'entrée, rendu à la sortie
        expect(leave, `mouse=${mouse} mode ${mode}`).to.include(
          `\x1b[?${mode}l`,
        );
      }
      expect(leave).to.include("\x1b[?25h");
    }
  });

  it("le journal suit la fin, la barre dit la PHASE même sans bilan", async () => {
    const { stdout, terminal } = fullscreen();
    terminal.setStatus(null, ctx, "building");
    terminal.ingest("server", "out", lines(30));
    await nextFrame();
    const shown = await screen(stdout.written);
    expect(shown.at(-1)).to.equal("mon-app · construction…");
    expect(shown.at(-2)).to.equal("ligne 30");
    expect(shown[0]).to.equal("ligne 20");
    terminal.close();
  });

  it("une image = UNE écriture, encadrée par la sortie synchronisée si la sonde l'a vue", async () => {
    const { stdout, terminal } = fullscreen({ synchronized: true });
    const before = stdout.written.length;
    terminal.ingest("server", "out", lines(5));
    await nextFrame();
    expect(stdout.written.length - before).to.equal(1);
    const frame = stdout.written.at(-1) ?? "";
    expect(frame.startsWith("\x1b[?2026h")).to.equal(true);
    expect(frame.endsWith("\x1b[?2026l")).to.equal(true);
    terminal.close();
  });

  it("une rafale de 5 000 lignes : nombre d'images BORNÉ par l'horloge, pas par les lignes", () => {
    vi.useFakeTimers();
    const { stdout, terminal } = fullscreen();
    vi.advanceTimersByTime(20);
    const before = stdout.written.length;
    // 5 000 lignes réparties sur 500 ms : au plus ~32 images de 16 ms.
    for (let i = 0; i < 500; i++) {
      terminal.ingest("server", "out", lines(10, i * 10 + 1));
      vi.advanceTimersByTime(1);
    }
    vi.advanceTimersByTime(20);
    const frames = stdout.written.length - before;
    expect(frames).to.be.greaterThan(0);
    expect(frames).to.be.at.most(Math.ceil(500 / 16) + 2);
    terminal.close();
  });

  it("ESC[2J du serveur : le direct repart d'une page propre", async () => {
    const { stdout, terminal } = fullscreen();
    terminal.ingest("server", "out", `${lines(5)}\x1b[2Jprêt\n`);
    await nextFrame();
    const shown = await screen(stdout.written);
    expect(shown.filter((l) => l.startsWith("ligne"))).to.deep.equal([]);
    expect(shown).to.include("prêt");
    terminal.close();
  });

  it("redimensionné : l'image entière est redessinée", async () => {
    const { stdout, terminal } = fullscreen();
    terminal.ingest("server", "out", lines(5));
    await nextFrame();
    terminal.resize();
    await nextFrame();
    expect(stdout.written.at(-1)).to.include("\x1b[2J");
    terminal.close();
  });
});

describe("plein écran — défilement (foyer)", () => {
  it("une ligne qui ouvre un lien sans le fermer ne déborde pas sur l'image", async () => {
    const { stdout, terminal } = fullscreen();
    terminal.setStatus(null, ctx, "ready");
    terminal.ingest(
      "server",
      "out",
      Buffer.from(
        "\x1b]8;;https://nodefony.net/doc\x1b\\jamais fermé\nsuite\n",
      ),
    );
    await nextFrame();
    const LINK = /\x1b\]8;[^;\x07\x1b]*;([^\x07\x1b]*)(?:\x1b\\|\x07)/g;
    for (const chunk of stdout.written) {
      let open = false;
      for (const m of chunk.matchAll(LINK)) open = (m[1] ?? "") !== "";
      expect(open, JSON.stringify(chunk.slice(-80))).to.equal(false);
    }
    terminal.close();
  });

  it("un hyperlien replié dont la fin passe sous la fenêtre ne reste pas ouvert", async () => {
    const { stdout, input, terminal } = fullscreen();
    terminal.setStatus(null, ctx, "ready");
    terminal.ingest("server", "out", lines(40));
    terminal.ingest(
      "server",
      "out",
      Buffer.from(
        "\x1b]8;;https://nodefony.net/doc\x1b\\" +
          "a".repeat(140) +
          "\x1b]8;;\x1b\\\n",
      ),
    );
    await nextFrame();
    input.type("\x1b[A");
    await nextFrame();
    const LINK = /\x1b\]8;[^;\x07\x1b]*;([^\x07\x1b]*)(?:\x1b\\|\x07)/g;
    for (const chunk of stdout.written) {
      let open = false;
      for (const m of chunk.matchAll(LINK)) open = (m[1] ?? "") !== "";
      expect(open, JSON.stringify(chunk.slice(-80))).to.equal(false);
    }
    terminal.close();
  });

  it("la molette (traduite en flèches par le terminal) remonte le journal ; les lignes qui arrivent ne le déplacent pas", async () => {
    const { stdout, input, terminal } = fullscreen();
    terminal.setStatus(null, ctx, "ready");
    terminal.ingest("server", "out", lines(40));
    await nextFrame();
    input.type("\x1b[A\x1b[A\x1b[A"); // un cran de molette, mode 1007
    await nextFrame();
    const scrolled = await screen(stdout.written);
    expect(terminal.anchor).to.not.equal(null);
    expect(scrolled.at(-3)).to.equal("ligne 37");
    expect(scrolled.at(-2)).to.include("3 nouvelles lignes");
    // Un rechargement à chaud pendant qu'on lit : on reste où l'on est.
    const before = stdout.written.length;
    terminal.ingest("server", "out", lines(20, 41));
    await nextFrame();
    const after = await screen(stdout.written);
    expect(after.slice(0, -2)).to.deep.equal(scrolled.slice(0, -2));
    expect(after.at(-2)).to.include("23 nouvelles lignes");
    // Seul l'indicateur a été réécrit.
    const redraw = stdout.written.slice(before).join("");
    expect(redraw.match(/\x1b\[\d+;1H/g)).to.have.length(1);
    terminal.close();
  });

  it("molette CAPTÉE (--mouse) : un cran défile comme un cran traduit en flèches", async () => {
    const { stdout, input, terminal } = fullscreen({ mouse: true });
    terminal.setStatus(null, ctx, "ready");
    terminal.ingest("server", "out", lines(40));
    await nextFrame();
    input.type("\x1b[<64;5;5M"); // un cran vers le haut, SGR
    await nextFrame();
    expect((await screen(stdout.written)).at(-3)).to.equal("ligne 37");
    input.type("\x1b[<65;5;5M"); // et retour
    await nextFrame();
    expect(terminal.anchor).to.equal(null);
    terminal.close();
  });

  it("Fin revient au direct, Début montre la première ligne, PgUp remonte d'une page", async () => {
    const { stdout, input, terminal } = fullscreen();
    terminal.ingest("server", "out", lines(40));
    await nextFrame();
    input.type("\x1b[H"); // Début
    await nextFrame();
    expect((await screen(stdout.written))[0]).to.equal("ligne 1");
    input.type("\x1b[F"); // Fin
    await nextFrame();
    expect(terminal.anchor).to.equal(null);
    input.type("\x1b[5~"); // PgUp
    await nextFrame();
    expect(terminal.anchor).to.not.equal(null);
    terminal.close();
  });

  it("Ctrl+C et Ctrl+D demandent l'arrêt au propriétaire — ce ne sont plus des signaux", () => {
    const { input, quit, terminal } = fullscreen();
    input.type("\x03");
    input.type("\x04");
    expect(quit).toHaveBeenCalledTimes(2);
    terminal.close();
  });

  it("un foyer ajouté passe EN TÊTE : il voit la touche avant le défilement", () => {
    const { input, terminal } = fullscreen();
    const seen: string[] = [];
    const focus: IInputFocus = {
      handle: (event) => {
        if (event.kind === "key") seen.push(event.key);
        return event.kind === "key" && event.key === "pageup";
      },
    };
    const remove = terminal.addFocus(focus);
    input.type("\x1b[5~");
    expect(seen).to.deep.equal(["pageup"]);
    expect(terminal.anchor).to.equal(null);
    remove();
    terminal.close();
  });
});

describe("plein écran — sélection à la souris (--mouse)", () => {
  /** Onze lignes : la ligne d'écran r (depuis 1) montre « ligne r ». */
  async function selecting(copy = vi.fn(async () => "copié — test")) {
    const t = fullscreen({ mouse: true, copy });
    t.terminal.setStatus(null, ctx, "ready");
    t.terminal.ingest("server", "out", lines(11));
    await nextFrame();
    return { ...t, copy };
  }

  it("glisser surligne de la cellule enfoncée à la cellule de tête, relâcher copie le texte LOGIQUE", async () => {
    const { stdout, input, terminal, copy } = await selecting();
    input.type(press(3, 2) + drag(4, 2) + drag(5, 3));
    await nextFrame();
    expect(await inverseCells(stdout.written, 1)).to.equal("..#####.....");
    expect(await inverseCells(stdout.written, 2)).to.equal("#####.......");
    expect(await inverseCells(stdout.written, 3)).to.equal("............");
    expect(copy).not.toHaveBeenCalled();
    input.type(release(5, 3));
    expect(copy).toHaveBeenCalledWith("gne 2\nligne");
    terminal.close();
  });

  it("un simple clic ne sélectionne rien et ne copie rien", async () => {
    const { stdout, input, terminal, copy } = await selecting();
    input.type(press(3, 2) + release(3, 2));
    await nextFrame();
    expect(await inverseCells(stdout.written, 1)).to.equal("............");
    expect(copy).not.toHaveBeenCalled();
    terminal.close();
  });

  it("double clic : le mot ; triple clic : la ligne", async () => {
    const { input, terminal, copy } = await selecting();
    input.type(press(2, 4) + release(2, 4) + press(2, 4) + release(2, 4));
    expect(copy).toHaveBeenLastCalledWith("ligne");
    input.type(press(2, 4) + release(2, 4));
    expect(copy).toHaveBeenLastCalledWith("ligne 4");
    terminal.close();
  });

  it("une ligne repliée sur deux lignes d'écran se copie SANS le retour du repli", async () => {
    const copy = vi.fn(async () => "copié");
    const { input, terminal } = fullscreen({ mouse: true, copy, columns: 20 });
    terminal.setStatus(null, ctx, "ready");
    const long = "abcdefghijklmnopqrstuvwxyz0123";
    terminal.ingest("server", "out", `${long}\n`);
    await nextFrame();
    // Largeur de repli 19 : la ligne occupe les deux dernières lignes du journal.
    input.type(press(1, 10) + drag(11, 11) + release(11, 11));
    expect(copy).toHaveBeenCalledWith(long);
    terminal.close();
  });

  it("défiler pendant la sélection : le surlignage suit le TEXTE, pas l'écran", async () => {
    const { stdout, input, terminal } = await selecting();
    input.type(press(1, 5) + drag(7, 5) + release(7, 5)); // « ligne 5 »
    await nextFrame();
    expect(await inverseCells(stdout.written, 4)).to.equal("#######.....");
    terminal.ingest("server", "out", lines(2, 12)); // le direct pousse tout de 2
    await nextFrame();
    expect((await screen(stdout.written))[2]).to.equal("ligne 5");
    expect(await inverseCells(stdout.written, 2)).to.equal("#######.....");
    expect(await inverseCells(stdout.written, 4)).to.equal("............");
    terminal.close();
  });

  it("Échap efface la sélection ; la barre dit le résultat de la copie", async () => {
    const { stdout, input, terminal } = await selecting();
    input.type(press(1, 5) + drag(7, 5) + release(7, 5));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await nextFrame();
    expect((await screen(stdout.written)).at(-1)).to.include("copié — test");
    input.type("\x1b");
    await new Promise((resolve) => setTimeout(resolve, 80)); // délai de l'Échap seul
    await nextFrame();
    expect(await inverseCells(stdout.written, 4)).to.equal("............");
    terminal.close();
  });
});

describe("plein écran — sélection sous le bloc d'état du serveur prêt", () => {
  const readyView: IStartupView = {
    schema: 1,
    ready: true,
    durationMs: 1200,
    version: "10.0.0",
    environment: "development",
    open: [],
    notices: [],
    listening: [],
    frontend: null,
    modules: { loaded: 3, gated: [], failed: 0 },
    journal: { warnings: 0, errors: 0, criticals: [] },
    data: [],
    processes: null,
    firewall: null,
    supervised: true,
    inspector: null,
  };

  it("remonté (PgUp), glisser copie ; la barre dit le résultat SANS perdre « ctrl+c arrêter »", async () => {
    const copy = vi.fn(async (_text: string) => "copié (pbcopy)");
    const { stdout, input, terminal } = fullscreen({
      mouse: true,
      copy,
      columns: 120,
      rows: 40,
    });
    terminal.setStatus(readyView, ctx, "ready");
    terminal.ingest("server", "out", lines(100));
    await nextFrame();
    input.type("\x1b[5~");
    await nextFrame();
    const up = await screen(stdout.written, 120, 40);
    const row = up.findIndex((l) => l.startsWith("ligne "));
    expect(row).to.not.equal(-1);
    const y = row + 1;
    input.type(press(1, y) + drag(5, y) + release(5, y));
    expect(copy).toHaveBeenCalledWith((up[row] ?? "").slice(0, 5));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await nextFrame();
    const bar = (await screen(stdout.written, 120, 40)).join("\n");
    expect(bar).to.include("copié (pbcopy)");
    expect(bar).to.include("ctrl+c arrêter");
    terminal.close();
  });
});

describe("plein écran — glisser au bord du journal (--mouse)", () => {
  const wait = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

  it("glisser sur la première ligne fait défiler : la sélection dépasse l'écran ; relâcher arrête", async () => {
    const copy = vi.fn(async (_text: string) => "copié");
    const { stdout, input, terminal } = fullscreen({ mouse: true, copy });
    terminal.setStatus(null, ctx, "ready");
    terminal.ingest("server", "out", lines(40)); // écran : lignes 30 à 40
    await nextFrame();
    expect((await screen(stdout.written))[0]).to.equal("ligne 30");
    input.type(press(1, 5) + drag(1, 1)); // de « ligne 34 » vers le haut
    await wait(250);
    expect(terminal.anchor).to.not.equal(null);
    input.type(release(1, 1));
    const copied = copy.mock.calls[0]?.[0] ?? "";
    const first = Number(/^ligne (\d+)/.exec(copied)?.[1]);
    expect(first).to.be.lessThan(30); // remontée au-delà de l'écran
    // Vers le haut, la sélection finit sur la cellule ENFONCÉE, incluse.
    expect(copied.split("\n").at(-1)).to.equal("l");
    const anchor = terminal.anchor;
    await wait(150);
    expect(terminal.anchor).to.deep.equal(anchor); // plus de défilement
    terminal.close();
  });

  it("glisser sous le journal (barre) fait redescendre ; revenir dans le journal arrête", async () => {
    const { input, terminal } = fullscreen({ mouse: true });
    terminal.setStatus(null, ctx, "ready");
    terminal.ingest("server", "out", lines(60));
    await nextFrame();
    input.type("\x1b[5~\x1b[5~\x1b[5~"); // trois pages plus haut
    await nextFrame();
    const top = terminal.anchor;
    expect(top).to.not.equal(null);
    input.type(press(1, 5) + drag(1, ROWS)); // la barre est la dernière ligne
    await wait(150);
    const moved = terminal.anchor;
    expect(moved === null || moved.seq > top!.seq).to.equal(true);
    input.type(drag(1, 5));
    const still = terminal.anchor;
    await wait(150);
    expect(terminal.anchor).to.deep.equal(still);
    input.type(release(1, 5));
    terminal.close();
  });
});

describe("surlignage — invertColumns", () => {
  it("une remise à zéro des couleurs DANS l'intervalle ne coupe pas l'inversion", async () => {
    const line = "\x1b[31mab\x1b[0mcd\x1b[32mef\x1b[0m";
    const out = invertColumns(line, 1, 5);
    expect(stripVTControlCharacters(out)).to.equal("abcdef");
    expect(await inverseCells([out], 0, 6)).to.equal(".####.");
  });

  it("un caractère large à moitié couvert est inversé entier", async () => {
    expect(await inverseCells([invertColumns("a漢b", 2, 3)], 0, 4)).to.equal(
      ".##.",
    );
  });
});

describe("plein écran — sortie", () => {
  it("rend le terminal, recopie le journal visible, puis continue en inline", async () => {
    const { stdout, input, terminal } = fullscreen();
    terminal.ingest("server", "out", lines(3));
    await nextFrame();
    terminal.leaveFullscreen();
    const leave = stdout.written.join("");
    for (const mode of ["2004", "1007", "1049"]) {
      expect(leave).to.include(`\x1b[?${mode}l`);
    }
    expect(leave).to.include("\x1b[?25h");
    expect(input.raw).to.equal(false);
    expect(input.paused).to.equal(true);
    expect(input.listenerCount("data")).to.equal(0);
    expect(terminal.surface).to.equal("inline");
    expect(stdout.written.at(-1)).to.equal("ligne 1\nligne 2\nligne 3\n");
    terminal.ingest("server", "out", "arrêt du serveur\n");
    expect(stdout.written.at(-1)).to.equal("arrêt du serveur\n");
    terminal.leaveFullscreen();
    terminal.close();
  });
});

describe("plein écran — restauration sur une exception non rattrapée", () => {
  it("le terminal est rendu AVANT que Node n'imprime la pile", async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = path.resolve(here, "..");
    const root = path.resolve(src, "..", "..", "..");
    const tsx = pathToFileURL(
      createRequire(path.join(root, "package.json")).resolve("tsx/esm"),
    ).href;
    const url = (rel: string): string =>
      pathToFileURL(path.join(src, ...rel.split("/"))).href;
    const script = `
      const { EventEmitter } = await import("node:events");
      const { DevTerminal } = await import(${JSON.stringify(url("service/dev/DevTerminal.ts"))});
      const input = Object.assign(new EventEmitter(), {
        setRawMode() {}, resume() {}, pause() {},
      });
      new DevTerminal({
        stdout: { columns: 80, rows: 24, write: (c) => process.stderr.write(c) },
        color: false, charset: "ascii", mark: [],
        fullscreen: { input, synchronized: false, onQuit() {} },
      });
      throw new Error("explosion");
    `;
    const err = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["--import", tsx, "--input-type=module", "-e", script],
        {
          cwd: root,
          env: { ...process.env, NODE_OPTIONS: "" },
          stdio: ["ignore", "ignore", "pipe"],
        },
      );
      let text = "";
      child.stderr.on("data", (d: Buffer) => (text += d.toString()));
      child.once("error", reject);
      child.once("close", () => resolve(text));
    });
    const left = err.indexOf("\x1b[?1049l");
    const stack = err.indexOf("explosion");
    expect(left, "écran alternatif jamais quitté").to.be.greaterThan(-1);
    expect(stack, "pile absente").to.be.greaterThan(-1);
    expect(left).to.be.lessThan(stack);
  }, 30_000);
});

describe("interrupteur du plein écran — --ui / --no-ui / NF_DEV_UI", () => {
  it("opt-in pendant la construction : rien demandé, pas de plein écran", () => {
    expect(readDevUiRequest(["development"], {})).to.deep.equal({
      fullscreen: false,
      invalid: null,
    });
  });

  it("la ligne de commande l'emporte sur l'environnement", () => {
    expect(readDevUiRequest(["--ui"], { NF_DEV_UI: "0" }).fullscreen).to.equal(
      true,
    );
    expect(
      readDevUiRequest(["--no-ui"], { NF_DEV_UI: "1" }).fullscreen,
    ).to.equal(false);
    expect(readDevUiRequest([], { NF_DEV_UI: "1" }).fullscreen).to.equal(true);
  });

  it("une valeur ni 1 ni 0 est NOMMÉE, pas interprétée", () => {
    expect(readDevUiRequest([], { NF_DEV_UI: "oui" })).to.deep.equal({
      fullscreen: false,
      invalid: "oui",
    });
  });
});

describe("interrupteur de la souris — --mouse / --no-mouse / NF_DEV_MOUSE", () => {
  it("rien demandé : la souris reste au terminal", () => {
    expect(readDevMouseRequest([], {})).to.deep.equal({
      capture: false,
      invalid: null,
    });
  });

  it("la ligne de commande l'emporte sur l'environnement", () => {
    expect(
      readDevMouseRequest(["--mouse"], { NF_DEV_MOUSE: "0" }).capture,
    ).to.equal(true);
    expect(
      readDevMouseRequest(["--no-mouse"], { NF_DEV_MOUSE: "1" }).capture,
    ).to.equal(false);
    expect(readDevMouseRequest([], { NF_DEV_MOUSE: "1" }).capture).to.equal(
      true,
    );
  });

  it("une valeur ni 1 ni 0 est NOMMÉE, pas interprétée", () => {
    expect(readDevMouseRequest([], { NF_DEV_MOUSE: "oui" })).to.deep.equal({
      capture: false,
      invalid: "oui",
    });
  });

  it("Windows avant Node 24.2 : capture refusée, raison nommée ; ailleurs rien ne s'y oppose", () => {
    expect(mouseCaptureBlocker("win32", "24.1.0")).to.include("24.2");
    expect(mouseCaptureBlocker("win32", "22.20.0")).to.include("22.20.0");
    expect(mouseCaptureBlocker("win32", "24.2.0")).to.equal(null);
    expect(mouseCaptureBlocker("win32", "26.10.0")).to.equal(null);
    expect(mouseCaptureBlocker("darwin", "24.0.0")).to.equal(null);
    expect(mouseCaptureBlocker("linux", "24.0.0")).to.equal(null);
  });
});

describe("sonde du terminal — constatée, jamais déduite", () => {
  /** Un clavier qui répond à la sonde comme le ferait un terminal. */
  function answering(reply: string | null) {
    const input = new FakeInput();
    const writes: string[] = [];
    const output = {
      write: (chunk: string): boolean => {
        writes.push(chunk);
        if (chunk === TERMINAL_PROBE && reply !== null) {
          setTimeout(() => input.type(reply), 5);
        }
        return true;
      },
    };
    return { input, output, writes };
  }

  it("le terminal répond : plein écran, sortie synchronisée si DECRQM l'a vue", async () => {
    const { input, output, writes } = answering("\x1b[?2026;2$y\x1b[12;1R");
    const result = await probeTerminal(input, output, 1000);
    expect(writes).to.deep.equal([TERMINAL_PROBE]);
    expect(result).to.deep.equal({
      fullscreen: true,
      synchronized: true,
      complete: true,
    });
    expect(input.raw).to.equal(false);
    expect(input.paused).to.equal(true);
    expect(input.listenerCount("data")).to.equal(0);
  });

  it("position seule (pas de DECRQM) : plein écran, sans sortie synchronisée", async () => {
    const { input, output } = answering("\x1b[3;7R");
    const result = await probeTerminal(input, output, 1000);
    expect(result.fullscreen).to.equal(true);
    expect(result.synchronized).to.equal(false);
  });

  it("terminal muet : surface inline après le délai, clavier rendu", async () => {
    const { input, output } = answering(null);
    const result = await probeTerminal(input, output, 50);
    expect(result.fullscreen).to.equal(false);
    expect(input.raw).to.equal(false);
    expect(input.listenerCount("data")).to.equal(0);
  });
});

describe("plein écran — l'aide de la barre dit les gestes changés", () => {
  const readyView: IStartupView = {
    schema: 1,
    ready: true,
    durationMs: 1200,
    version: "10.0.0",
    environment: "development",
    open: [],
    notices: [],
    listening: [],
    frontend: null,
    modules: { loaded: 3, gated: [], failed: 0 },
    journal: { warnings: 0, errors: 0, criticals: [] },
    data: [],
    processes: null,
    firewall: null,
    supervised: true,
    inspector: null,
  };

  // Le nom du projet vient de la configuration de l'application : la barre
  // l'assainit comme toute ligne du journal (ADR-0013 §3).
  it("la barre n'émet ni presse-papiers ni titre glissés dans le nom du projet", async () => {
    const evil = {
      ...ctx,
      project: "app\x1b]52;c;aGk=\x07\x1b]0;titre\x07",
    };
    for (const [v, phase] of [
      [null, "building"],
      [readyView, "ready"],
    ] as const) {
      const { stdout, terminal } = fullscreen({ columns: 120, rows: 40 });
      terminal.setStatus(v, evil, phase);
      terminal.ingest("server", "out", lines(3));
      await nextFrame();
      const all = stdout.written.join("");
      expect(all, phase).to.not.include("\x1b]52");
      expect(all, phase).to.not.include("\x1b]0;");
      terminal.close();
    }
  });

  it("défiler, revenir au direct, arrêter — dans la barre du serveur prêt", async () => {
    const { stdout, terminal } = fullscreen({ columns: 120, rows: 40 });
    terminal.setStatus(readyView, ctx, "ready");
    terminal.ingest("server", "out", lines(3));
    await nextFrame();
    const shown = (await screen(stdout.written, 120, 40)).join("\n");
    expect(shown).to.include("PgUp défiler");
    expect(shown).to.include("Fin direct");
    expect(shown).to.include("ctrl+c arrêter");
    terminal.close();
  });

  it("en ligne, l'aide reste le seul geste d'arrêt", () => {
    const stdout = output(100, 40);
    const terminal = new DevTerminal({
      stdout,
      color: false,
      charset: "unicode",
      mark: brandMark("unicode", false),
    });
    terminal.setStatus(readyView, ctx, "ready");
    const bar = stdout.written.join("");
    expect(bar).to.include("ctrl+c arrêter");
    expect(bar).to.not.include("défiler");
    terminal.close();
  });
});

describe("barre étroite — le geste d'arrêt ne tombe pas avec l'aide", () => {
  it("l'aide complète ne tient pas, l'arrêt si : la ligne garde « ctrl+c arrêter »", async () => {
    const { stdout, terminal } = fullscreen({ columns: 100, rows: 12 });
    terminal.setStatus(
      {
        schema: 1,
        ready: true,
        durationMs: 1,
        version: "10.0.0",
        environment: "development",
        open: [],
        notices: [],
        listening: [],
        frontend: null,
        modules: { loaded: 1, gated: [], failed: 0 },
        journal: { warnings: 0, errors: 0, criticals: [] },
        data: [],
        processes: null,
        firewall: null,
        supervised: true,
        inspector: null,
      },
      ctx,
      "ready",
    );
    await nextFrame();
    const bar = (await screen(stdout.written, 100, 12)).at(-1) ?? "";
    expect(bar).to.include("ctrl+c arrêter");
    terminal.close();
  });
});

describe("plein écran — jamais un écran vide", () => {
  it("avant le premier bilan du serveur (un build peut durer), la barre dit la phase", async () => {
    const stdout = output();
    const terminal = new DevTerminal({
      stdout,
      color: false,
      charset: "unicode",
      mark: brandMark("unicode", false),
      project: "mon-app",
      fullscreen: {
        input: new FakeInput(),
        synchronized: false,
        onQuit: () => {},
      },
    });
    await nextFrame();
    expect((await screen(stdout.written)).at(-1)).to.equal(
      "mon-app · démarrage…",
    );
    terminal.setPhase("building");
    await nextFrame();
    expect((await screen(stdout.written)).at(-1)).to.equal(
      "mon-app · construction…",
    );
    terminal.close();
  });
});
