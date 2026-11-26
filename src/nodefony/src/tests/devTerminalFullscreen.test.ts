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
  readDevPaint,
  type DevPaint,
  readDevMouseRequest,
  readDevUiRequest,
} from "../service/dev/outputMode";
import type { IDevBand } from "../service/dev/devBand";
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
    paint?: DevPaint;
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
      ...(options.paint === undefined ? {} : { paint: options.paint }),
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

/** Laisse passer la file des copies (elles s'enchaînent par promesses). */
const settle = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

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
    await settle();
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
    await settle();
    expect(copy).toHaveBeenLastCalledWith("ligne");
    input.type(press(2, 4) + release(2, 4));
    await settle();
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
    // Largeur de repli 19 : la ligne occupe les deux PREMIÈRES lignes du
    // journal (en direct, une page courte part du haut).
    input.type(press(1, 1) + drag(11, 2) + release(11, 2));
    await settle();
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
    // Échap seul : attendre la sélection EFFACÉE, pas une durée.
    await vi.waitFor(async () => {
      expect(await inverseCells(stdout.written, 4)).to.equal("............");
    });
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
    await settle();
    expect(copy).toHaveBeenCalledWith((up[row] ?? "").slice(0, 5));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await nextFrame();
    const bar = (await screen(stdout.written, 120, 40)).join("\n");
    expect(bar).to.include("copié (pbcopy)");
    terminal.close();
  });

  it("un clic sur l'adresse de la barre la copie — et la molette défile toujours le journal", async () => {
    const app = "http://127.0.0.1:5151";
    const copy = vi.fn(async (_text: string) => "copié (pbcopy)");
    const { stdout, input, terminal } = fullscreen({
      mouse: true,
      copy,
      columns: 120,
      rows: 40,
    });
    terminal.setStatus(
      {
        ...readyView,
        open: [{ id: "app", label: "Application", url: app }],
      },
      ctx,
      "ready",
    );
    terminal.ingest("server", "out", lines(100));
    await nextFrame();
    const shown = await screen(stdout.written, 120, 40);
    const row = shown.findIndex((l) => l.includes(app));
    expect(row, shown.join("\n")).to.not.equal(-1);
    const column = (shown[row] ?? "").indexOf(app) + 1;

    // À côté de l'adresse : rien n'est copié.
    if (column > 2) {
      input.type(press(column - 2, row + 1) + release(column - 2, row + 1));
      await settle();
      expect(copy).not.toHaveBeenCalled();
    }
    // Sur l'adresse, au milieu : l'adresse entière part.
    input.type(press(column + 5, row + 1) + release(column + 5, row + 1));
    await settle();
    expect(copy).toHaveBeenCalledWith(app);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await nextFrame();
    expect((await screen(stdout.written, 120, 40)).join("\n")).to.include(
      "copié (pbcopy)",
    );

    // La souris reste au plein écran : la molette remonte le journal.
    input.type("\x1b[<64;5;5M\x1b[<64;5;5M\x1b[<64;5;5M");
    await nextFrame();
    expect(terminal.anchor).to.not.equal(null);
    terminal.close();
  });
});

describe("plein écran — sélection : cas limites relevés en contre-revue", () => {
  async function eleven(copy: (text: string) => Promise<string>) {
    const t = fullscreen({ mouse: true, copy });
    t.terminal.setStatus(null, ctx, "ready");
    t.terminal.ingest("server", "out", lines(11));
    await nextFrame();
    return t;
  }

  it("triple clic : les copies s'enchaînent — la LIGNE gagne, jamais le mot du double clic", async () => {
    const pending: Array<() => void> = [];
    const copy = vi.fn(
      (text: string) =>
        new Promise<string>((resolve) => {
          pending.push(() => resolve(`copié « ${text} »`));
        }),
    );
    const { stdout, input, terminal } = await eleven(copy);
    input.type(press(2, 4) + release(2, 4) + press(2, 4) + release(2, 4));
    await settle();
    expect(copy).toHaveBeenCalledTimes(1); // le mot
    input.type(press(2, 4) + release(2, 4));
    await settle();
    expect(copy).toHaveBeenCalledTimes(1); // la ligne attend que le mot ait fini
    pending.shift()?.();
    await settle();
    expect(copy).toHaveBeenLastCalledWith("ligne 4");
    pending.shift()?.();
    await settle();
    await nextFrame();
    expect((await screen(stdout.written)).at(-1)).to.include(
      "copié « ligne 4 »",
    );
    terminal.close();
  });

  it("glisser commencé sur la PREMIÈRE ligne la sélectionne, sans faire défiler", async () => {
    const copy = vi.fn(async (_text: string) => "copié");
    const { input, terminal } = await eleven(copy);
    input.type(press(1, 1) + drag(5, 1) + drag(7, 1));
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(terminal.anchor).to.equal(null);
    input.type(release(7, 1));
    await settle();
    expect(copy).toHaveBeenCalledWith("ligne 1");
    terminal.close();
  });

  it("un clic hors du journal (la barre) ne vise aucune ligne : triple clic, rien copié", async () => {
    const copy = vi.fn(async (_text: string) => "copié");
    const { input, terminal } = await eleven(copy);
    const bar = ROWS; // la barre est la dernière ligne
    input.type(
      press(2, bar) + release(2, bar) + press(2, bar) + release(2, bar),
    );
    input.type(press(2, bar) + release(2, bar));
    await settle();
    expect(copy).not.toHaveBeenCalled();
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
    await settle();
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
  it("rien demandé : le DÉFAUT de la plateforme — oui sous macOS et Linux, non sous Windows", () => {
    for (const platform of ["darwin", "linux"]) {
      expect(
        readDevUiRequest(["development"], {}, platform),
        platform,
      ).to.deep.equal({
        fullscreen: true,
        byDefault: true,
        invalid: null,
      });
    }
    expect(readDevUiRequest(["development"], {}, "win32")).to.deep.equal({
      fullscreen: false,
      byDefault: true,
      invalid: null,
    });
  });

  it("la ligne de commande l'emporte sur l'environnement, et l'un comme l'autre sur le défaut", () => {
    expect(
      readDevUiRequest(["--ui"], { NF_DEV_UI: "0" }, "darwin").fullscreen,
    ).to.equal(true);
    expect(
      readDevUiRequest(["--no-ui"], { NF_DEV_UI: "1" }, "darwin").fullscreen,
    ).to.equal(false);
    // Un agent l'écarte d'un signal EXPLICITE — on ne devine pas « c'est une IA ».
    expect(readDevUiRequest([], { NF_DEV_UI: "0" }, "linux")).to.deep.equal({
      fullscreen: false,
      byDefault: false,
      invalid: null,
    });
    expect(readDevUiRequest(["--ui"], {}, "win32")).to.deep.equal({
      fullscreen: true,
      byDefault: false,
      invalid: null,
    });
    expect(
      readDevUiRequest(
        [],
        { AI_AGENT: "claude-code", CLAUDECODE: "1" },
        "darwin",
      ).fullscreen,
    ).to.equal(true);
  });

  it("une valeur ni 1 ni 0 est NOMMÉE, pas interprétée — le défaut s'applique", () => {
    expect(readDevUiRequest([], { NF_DEV_UI: "oui" }, "win32")).to.deep.equal({
      fullscreen: false,
      byDefault: true,
      invalid: "oui",
    });
  });
});

describe("interrupteur de la souris — --mouse / --no-mouse / NF_DEV_MOUSE", () => {
  it("rien demandé : captée sous macOS et Linux, laissée au terminal sous Windows", () => {
    expect(readDevMouseRequest([], {}, "darwin")).to.deep.equal({
      capture: true,
      byDefault: true,
      invalid: null,
    });
    expect(readDevMouseRequest([], {}, "win32")).to.deep.equal({
      capture: false,
      byDefault: true,
      invalid: null,
    });
  });

  it("la ligne de commande l'emporte sur l'environnement, et l'un comme l'autre sur le défaut", () => {
    expect(
      readDevMouseRequest(["--mouse"], { NF_DEV_MOUSE: "0" }, "win32").capture,
    ).to.equal(true);
    expect(
      readDevMouseRequest(["--no-mouse"], { NF_DEV_MOUSE: "1" }, "darwin")
        .capture,
    ).to.equal(false);
    expect(
      readDevMouseRequest([], { NF_DEV_MOUSE: "0" }, "linux").capture,
    ).to.equal(false);
  });

  it("une valeur ni 1 ni 0 est NOMMÉE, pas interprétée", () => {
    expect(
      readDevMouseRequest([], { NF_DEV_MOUSE: "oui" }, "linux"),
    ).to.deep.equal({
      capture: true,
      byDefault: true,
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

  it("le terminal répond : plein écran, sortie synchronisée si DECRQM l'a vue, sa couleur de fond", async () => {
    const { input, output, writes } = answering(
      "\x1b[?2026;2$y\x1b]11;rgb:1e1e/1e1e/1e1e\x07\x1b[12;1R",
    );
    const result = await probeTerminal(input, output, 1000);
    expect(writes).to.deep.equal([TERMINAL_PROBE]);
    expect(result).to.deep.equal({
      fullscreen: true,
      synchronized: true,
      complete: true,
      background: [30, 30, 30],
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

  it("serveur prêt : aucune aide permanente dans la barre — la dernière ligne attend un message", async () => {
    const { stdout, terminal } = fullscreen({ columns: 120, rows: 40 });
    terminal.setStatus(readyView, ctx, "ready");
    terminal.ingest("server", "out", lines(3));
    await nextFrame();
    const bar = (await screen(stdout.written, 120, 40)).slice(-7);
    const text = bar.join("\n");
    for (const help of ["PgUp", "Fin direct", "ctrl+c arrêter", "glisser"]) {
      expect(text, help).to.not.include(help);
    }
    expect(bar.at(-1)?.trim().length).to.be.lessThan(12); // le logo seul
    terminal.close();
  });

  it("en ligne non plus, pas d'aide permanente", () => {
    const stdout = output(100, 40);
    const terminal = new DevTerminal({
      stdout,
      color: false,
      charset: "unicode",
      mark: brandMark("unicode", false),
    });
    terminal.setStatus(readyView, ctx, "ready");
    const bar = stdout.written.join("");
    expect(bar).to.include("mon-app");
    expect(bar).to.not.include("ctrl+c arrêter");
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

describe("plein écran — la partie centrale de la barre est vivante", () => {
  function sized() {
    const stdout = output(120, 40);
    const terminal = new DevTerminal({
      stdout,
      color: false,
      charset: "unicode",
      mark: brandMark("unicode", false),
      project: "mon-app",
      version: "10.0.0-beta.2",
      fullscreen: { input: new FakeInput(), synchronized: false, onQuit() {} },
    });
    return { stdout, terminal };
  }
  const barText = async (written: readonly string[]) =>
    (await screen(written, 120, 40)).slice(-7).join("\n");

  it("phase active : tourniquet ANIMÉ, étape et jauge des étapes du noyau", async () => {
    const { stdout, terminal } = sized();
    terminal.setPhase("booting");
    terminal.setActivity("Services & ORM", { done: 3, total: 5 });
    await nextFrame();
    const first = await barText(stdout.written);
    expect(first).to.include("démarrage…");
    expect(first).to.include("Services & ORM");
    expect(first).to.include("▰▰▰▱▱ 3/5");
    // Le tourniquet change d'image sans que rien d'autre n'arrive.
    const frames = new Set<string>();
    for (let i = 0; i < 4; i++) {
      await new Promise((resolve) => setTimeout(resolve, 90));
      const m = /([⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]) démarrage/.exec(await barText(stdout.written));
      if (m?.[1]) frames.add(m[1]);
    }
    expect(frames.size).to.be.greaterThan(1);
    terminal.close();
  });

  it("hors phase active : AUCUN minuteur ne reste armé (pas d'animation au repos)", () => {
    vi.useFakeTimers();
    const { terminal } = sized();
    terminal.setPhase("building");
    vi.advanceTimersByTime(200);
    expect(vi.getTimerCount()).to.be.greaterThan(0); // le tourniquet tourne
    terminal.setPhase("crashed");
    vi.advanceTimersByTime(200); // l'image en attente part
    // Une image inchangée n'écrit rien : seul le compte des minuteurs voit
    // une animation qui tournerait pour rien.
    expect(vi.getTimerCount()).to.equal(0);
    terminal.close();
  });

  it("serveur prêt : la ligne runtime vit ; elle disparaît dès qu'il redémarre", async () => {
    const { stdout, terminal } = sized();
    const view: IStartupView = {
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
    };
    terminal.setRuntime({ rssBytes: 1, cpuPercent: 1, eluPercent: 1 });
    terminal.setStatus(view, ctx, "ready");
    await nextFrame();
    expect(await barText(stdout.written)).to.not.include("mémoire"); // reçu avant « prêt » : ignoré
    terminal.setRuntime({
      rssBytes: 332 * 1024 * 1024,
      cpuPercent: 2,
      eluPercent: 3,
    });
    await nextFrame();
    expect(await barText(stdout.written)).to.include(
      "mémoire 332 MB  ·  CPU 2 %  ·  boucle 3 %",
    );
    terminal.setPhase("restarting");
    terminal.setPhase("ready");
    await nextFrame();
    expect(await barText(stdout.written)).to.not.include("mémoire");
    terminal.close();
  });

  it("build en échec, serveur conservé : la ligne d'état le dit au lieu de « prêt », jusqu'au build suivant", async () => {
    const { stdout, terminal } = sized();
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
    terminal.setIssue("build en échec — serveur précédent conservé");
    await nextFrame();
    let bar = await barText(stdout.written);
    expect(bar).to.include("build en échec — serveur précédent conservé");
    expect(bar).to.not.include("prêt à");
    terminal.setIssue(null);
    await nextFrame();
    bar = await barText(stdout.written);
    expect(bar).to.include("prêt à");
    terminal.close();
  });
});

describe("plein écran — le logo dès le démarrage", () => {
  it("avant le premier bilan, la barre est déjà le BLOC : logo, projet, version du framework, phase", async () => {
    const stdout = output(120, 40);
    const terminal = new DevTerminal({
      stdout,
      color: false,
      charset: "unicode",
      mark: brandMark("unicode", false),
      project: "mon-app",
      version: "10.0.0-beta.2",
      fullscreen: { input: new FakeInput(), synchronized: false, onQuit() {} },
    });
    terminal.setPhase("building");
    await nextFrame();
    const shown = await screen(stdout.written, 120, 40);
    const bar = shown.slice(-7);
    expect(bar[0]).to.match(/^─+$/); // le filet du bloc
    const text = bar.join("\n");
    expect(text).to.include("mon-app");
    expect(text).to.include("Nodefony 10.0.0-beta.2");
    expect(text).to.include("construction…");
    // La marque du logo occupe la gauche du bloc.
    const mark = brandMark("unicode", false);
    expect(bar[1]?.startsWith((mark[0] ?? "").trimEnd().slice(0, 4))).to.equal(
      true,
    );
    terminal.close();
  });
});

describe("plein écran — l'indicateur de build se voit", () => {
  it("la ligne EN COURS du superviseur (réécrite sur place, sans fin de ligne) s'affiche sous le journal, puis cède la place au verdict", async () => {
    const { stdout, terminal } = fullscreen();
    terminal.setStatus(null, ctx, "building");
    terminal.ingest("server", "out", lines(2));
    terminal.ingest(
      "supervisor",
      "out",
      "\r\x1b[2K[dev] ⠋ Build du framework…",
    );
    await nextFrame();
    let shown = await screen(stdout.written);
    expect(shown.slice(0, 3)).to.deep.equal([
      "ligne 1",
      "ligne 2",
      "[dev] ⠋ Build du framework…",
    ]);
    expect(shown.at(-1)).to.include("construction…");
    // L'image suivante du spinner REMPLACE la ligne, elle ne s'empile pas.
    terminal.ingest(
      "supervisor",
      "out",
      "\r\x1b[2K[dev] ⠙ Build du framework…",
    );
    await nextFrame();
    shown = await screen(stdout.written);
    expect(shown[2]).to.equal("[dev] ⠙ Build du framework…");
    expect(shown[3]).to.equal("");
    terminal.ingest(
      "supervisor",
      "out",
      "\r\x1b[2K[dev] ✓ Framework prêt (12ms)\n",
    );
    await nextFrame();
    shown = await screen(stdout.written);
    expect(shown[2]).to.equal("[dev] ✓ Framework prêt (12ms)");
    expect(shown[3]).to.equal("");
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

describe("plein écran — onglets serveur et vite (#903)", () => {
  const vite = (n: number, from = 1): string =>
    Array.from({ length: n }, (_, i) => `vite ${i + from}\n`).join("");

  it("tant que Vite n'a rien écrit, aucune ligne d'onglets : l'écran d'une seule vue", async () => {
    const { stdout, terminal } = fullscreen();
    terminal.ingest("server", "out", lines(3));
    await nextFrame();
    expect((await screen(stdout.written)).join("\n")).to.not.include("serveur");
    terminal.close();
  });

  it("Vite écrit : la ligne d'onglets apparaît, le serveur reste à l'écran, vite compte ses lignes", async () => {
    const { stdout, terminal } = fullscreen();
    terminal.ingest("server", "out", lines(3));
    terminal.ingest("vite:default", "out", vite(4));
    await nextFrame();
    const shown = await screen(stdout.written);
    expect(shown).to.include("[1 serveur]│ 2 vite ·4 │");
    expect(shown.join("\n")).to.include("ligne 3");
    expect(shown.join("\n")).to.not.include("vite 1");
    expect(terminal.activeView).to.equal("server");
    terminal.close();
  });

  it("Alt+2 montre vite, Alt+1 revient : chaque onglet retrouve sa position de lecture", async () => {
    const { stdout, input, terminal } = fullscreen();
    terminal.ingest("server", "out", lines(40));
    terminal.ingest("vite:default", "out", vite(2));
    await nextFrame();
    input.type("\x1b[5~"); // PgUp : le serveur remonté
    await nextFrame();
    const anchor = terminal.anchor;
    expect(anchor).to.not.equal(null);
    input.type("\x1b2");
    await nextFrame();
    expect(terminal.activeView).to.equal("vite");
    expect(terminal.anchor).to.equal(null);
    let shown = await screen(stdout.written);
    expect(shown[0]).to.equal("vite 1");
    expect(shown).to.include(" 1 serveur │[2 vite]│");
    input.type("\x1b1");
    await nextFrame();
    expect(terminal.activeView).to.equal("server");
    expect(terminal.anchor).to.deep.equal(anchor);
    shown = await screen(stdout.written);
    expect(shown.join("\n")).to.not.include("vite 1");
    terminal.close();
  });

  it("Alt+symbole de la rangée des chiffres (VS Code, clavier français) : même onglet que Alt+chiffre", async () => {
    // Maj+Option+1 d'un clavier français arrive en `ESC !` sous VS Code
    // (xterm.js traduit par la position de la touche sur un clavier américain).
    const { input, terminal } = fullscreen();
    terminal.ingest("server", "out", lines(5));
    terminal.ingest("vite:default", "out", vite(2));
    await nextFrame();
    input.type("\x1b@");
    await nextFrame();
    expect(terminal.activeView).to.equal("vite");
    input.type("\x1b!");
    await nextFrame();
    expect(terminal.activeView).to.equal("server");
    input.type("\x1b(");
    await nextFrame();
    expect(terminal.activeView, "un rang sans onglet ne change rien").to.equal(
      "server",
    );
    terminal.close();
  });

  it("le compteur d'un onglet caché repart de zéro une fois l'onglet vu ; un Vite ouvert plus tard y entre", async () => {
    const { stdout, input, terminal } = fullscreen();
    terminal.ingest("server", "out", lines(2));
    terminal.ingest("vite:default", "out", vite(3));
    await nextFrame();
    expect(await screen(stdout.written)).to.include("[1 serveur]│ 2 vite ·3 │");
    input.type("\x1b2");
    await nextFrame();
    input.type("\x1b1");
    await nextFrame();
    expect(await screen(stdout.written)).to.include("[1 serveur]│ 2 vite │");
    terminal.ingest("vite:admin", "out", vite(2, 4));
    await nextFrame();
    expect(await screen(stdout.written)).to.include("[1 serveur]│ 2 vite ·2 │");
    terminal.close();
  });

  it("l'onglet vite n'hérite ni de la page propre du serveur ni de l'indicateur du superviseur", async () => {
    const { stdout, input, terminal } = fullscreen();
    terminal.ingest("vite:default", "out", vite(2));
    terminal.ingest("server", "out", "ligne 1\n\x1b[2Jprêt\n");
    terminal.ingest("supervisor", "out", "construction en cours");
    await nextFrame();
    const server = (await screen(stdout.written)).join("\n");
    expect(server).to.include("construction en cours");
    expect(server).to.not.include("ligne 1");
    input.type("\x1b2");
    await nextFrame();
    const shown = await screen(stdout.written);
    expect(shown.slice(0, 2)).to.deep.equal(["vite 1", "vite 2"]);
    expect(shown.join("\n")).to.not.include("construction en cours");
    terminal.close();
  });

  it("--mouse : un clic sur un onglet le montre", async () => {
    const { stdout, input, terminal } = fullscreen({ mouse: true });
    terminal.ingest("server", "out", lines(2));
    terminal.ingest("vite:default", "out", vite(1));
    await nextFrame();
    const shown = await screen(stdout.written);
    const row = shown.findIndex((l) => l.includes("2 vite"));
    const column = (shown[row] ?? "").indexOf("2 vite") + 1;
    expect(row).to.not.equal(-1);
    input.type(press(column + 2, row + 1) + release(column + 2, row + 1));
    await nextFrame();
    expect(terminal.activeView).to.equal("vite");
    expect((await screen(stdout.written))[0]).to.equal("vite 1");
    terminal.close();
  });

  it("une erreur dans un onglet caché met son compteur au rouge ; le montrer l'efface", async () => {
    const stdout = output();
    const input = new FakeInput();
    const terminal = new DevTerminal({
      stdout,
      color: true,
      charset: "unicode",
      mark: brandMark("unicode", true),
      fullscreen: { input, synchronized: false, onQuit: () => {} },
    });
    terminal.ingest("server", "out", lines(1));
    terminal.ingest("vite:default", "out", vite(1));
    await nextFrame();
    expect(stdout.written.join("")).to.include(
      "\x1b[2m2 vite\x1b[22m\x1b[2m ·1\x1b[22m",
    );
    terminal.ingest("vite:default", "err", "échec\n");
    await nextFrame();
    expect(stdout.written.at(-1)).to.include(
      "\x1b[2m2 vite\x1b[22m\x1b[31m ·2\x1b[39m",
    );
    input.type("\x1b2");
    await nextFrame();
    input.type("\x1b1");
    await nextFrame();
    terminal.ingest("vite:default", "out", vite(1, 2));
    await nextFrame();
    expect(stdout.written.at(-1)).to.include(
      "\x1b[2m2 vite\x1b[22m\x1b[2m ·1\x1b[22m",
    );
    terminal.close();
  });
});

describe("plein écran — onglets ouverts à la volée (#903, N8)", () => {
  it("addView : l'onglet paraît dès l'ouverture, même vide, et prend son canal au serveur — même déjà écrit", async () => {
    const { stdout, input, terminal } = fullscreen();
    terminal.ingest("server", "out", lines(2));
    terminal.ingest("agent:1", "out", "avant\n");
    await nextFrame();
    expect((await screen(stdout.written)).join("\n")).to.include("avant");
    terminal.addView({ id: "agent:1", title: "agent", channels: "agent:1" });
    terminal.addView({ id: "agent:2", title: "vide", channels: "agent:2" });
    await nextFrame();
    let shown = await screen(stdout.written);
    expect(shown).to.include("[1 serveur]┃ 2 agent ·1 │ 3 vide │");
    expect(shown.join("\n")).to.not.include("avant");
    input.type("\x1b2");
    await nextFrame();
    shown = await screen(stdout.written);
    expect(terminal.activeView).to.equal("agent:1");
    expect(shown[0]).to.equal("avant");
    terminal.close();
  });

  it("finish marque l'issue ; close à l'écran ramène le serveur, retire l'onglet et libère l'historique du canal", async () => {
    const { stdout, input, terminal } = fullscreen();
    terminal.ingest("server", "out", lines(2));
    const view = terminal.addView({
      id: "agent:1",
      title: "agent",
      channels: (channel) => channel.startsWith("agent:1"),
    });
    terminal.ingest("agent:1", "out", "travail\n");
    terminal.ingest("agent:1/outil", "out", "outil\n");
    await nextFrame();
    input.type("\x1b2");
    await nextFrame();
    view.finish("failed");
    await nextFrame();
    expect(
      (await screen(stdout.written)).find((l) => l.includes("agent")),
    ).to.equal(" 1 serveur ┃[✗ 2 agent]│");
    view.close();
    view.close();
    await nextFrame();
    expect(terminal.activeView).to.equal("server");
    expect(terminal.history.channel("agent:1")).to.equal(undefined);
    expect(terminal.history.channel("agent:1/outil")).to.equal(undefined);
    const shown = (await screen(stdout.written)).join("\n");
    expect(shown).to.not.include("agent");
    expect(shown).to.include("ligne 2");
    terminal.close();
  });

  it("un identifiant déjà ouvert est refusé en le nommant", () => {
    const { terminal } = fullscreen();
    terminal.addView({ id: "agent:1", title: "agent", channels: "agent:1" });
    expect(() =>
      terminal.addView({ id: "agent:1", title: "bis", channels: "agent:1" }),
    ).to.throw("agent:1");
    expect(() =>
      terminal.addView({ id: "vite", title: "bis", channels: "x" }),
    ).to.throw("vite");
    terminal.close();
  });

  it("--mouse, trop d'onglets pour la largeur : un clic sur « ‹ +N » montre le voisin caché", async () => {
    const { stdout, input, terminal } = fullscreen({
      mouse: true,
      columns: 30,
    });
    terminal.ingest("server", "out", lines(1));
    for (let i = 1; i <= 6; i++) {
      terminal.addView({ id: `a${i}`, title: `a${i}`, channels: `a${i}` });
    }
    await nextFrame();
    input.type("\x1b7");
    await nextFrame();
    expect(terminal.activeView).to.equal("a6");
    const shown = await screen(stdout.written);
    const row = shown.findIndex((l) => l.includes("‹ +"));
    expect(row).to.not.equal(-1);
    const column = (shown[row] ?? "").indexOf("‹") + 1;
    input.type(press(column, row + 1) + release(column, row + 1));
    await nextFrame();
    expect(terminal.activeView).to.not.equal("a6");
    expect(terminal.activeView).to.match(/^a\d$/);
    terminal.close();
  });
});

describe("plein écran — la bande (#903)", () => {
  /** Une bande qui garde TOUT et note ce qu'elle reçoit. */
  const greedy = () => {
    const seen: { kind: string; row?: number; column?: number }[] = [];
    const band: IDevBand = {
      height: () => 2,
      render: () => ["bande 1", "bande 2"],
      handle: (event) => {
        seen.push(
          event.kind === "mouse" || event.kind === "wheel"
            ? { kind: event.kind, row: event.row, column: event.column }
            : { kind: event.kind },
        );
        return true;
      },
    };
    return { seen, band };
  };

  it("? ouvre l'aide des gestes ; ?, q, Échap la referment, F1 aussi l'ouvre", async () => {
    const { stdout, input, terminal } = fullscreen();
    terminal.ingest("server", "out", lines(20));
    await nextFrame();
    expect((await screen(stdout.written)).join("\n")).to.not.include("Gestes");
    input.type("?");
    await nextFrame();
    let shown = await screen(stdout.written);
    expect(shown.join("\n")).to.include("Gestes");
    expect(shown.join("\n")).to.include("changer d'onglet");
    // AZERTY : Maj+Alt hors VS Code, l'aide le dit (sinon Alt+1 est introuvable).
    expect(shown.join("\n")).to.include("idem en AZERTY, hors VS Code");
    input.type("?");
    await nextFrame();
    expect((await screen(stdout.written)).join("\n")).to.not.include("Gestes");
    input.type("\x1bOP");
    await nextFrame();
    expect((await screen(stdout.written)).join("\n")).to.include("Gestes");
    input.type("q");
    await nextFrame();
    expect((await screen(stdout.written)).join("\n")).to.not.include("Gestes");
    input.type("?");
    await nextFrame();
    input.type("\x1b");
    // Échap seul : attendre la bande RETIRÉE, pas une durée.
    await vi.waitFor(() => expect(terminal.band).to.equal(null));
    await nextFrame();
    shown = await screen(stdout.written);
    expect(shown.join("\n")).to.not.include("Gestes");
    expect(terminal.band).to.equal(null);
    terminal.close();
  });

  it("l'aide ouverte, le défilement et Alt+N passent : elle rend ce qu'elle ne garde pas", async () => {
    const { input, terminal } = fullscreen();
    terminal.ingest("server", "out", lines(40));
    terminal.ingest("vite:default", "out", "vite 1\n");
    await nextFrame();
    input.type("?");
    await nextFrame();
    input.type("\x1b[5~");
    await nextFrame();
    expect(terminal.anchor).to.not.equal(null);
    input.type("\x1b2");
    await nextFrame();
    expect(terminal.activeView).to.equal("vite");
    expect(terminal.band).to.not.equal(null);
    terminal.close();
  });

  it("sous une autre bande, ? ne rouvre pas l'aide une seconde fois", async () => {
    const { input, terminal } = fullscreen();
    input.type("?");
    const help = terminal.band;
    const close = terminal.openBand({
      height: () => 1,
      render: () => ["dessus"],
      handle: () => false,
    });
    input.type("?");
    close();
    expect(terminal.band).to.equal(help);
    terminal.close();
  });

  it("une bande qui garde tout ne retient pas Ctrl+C ; la refermer deux fois est sans effet", async () => {
    const { stdout, input, quit, terminal } = fullscreen();
    terminal.ingest("server", "out", lines(20));
    const { seen, band } = greedy();
    const close = terminal.openBand(band);
    await nextFrame();
    expect(await screen(stdout.written)).to.include("bande 2");
    input.type("x\x1b[5~");
    expect(seen.map((e) => e.kind)).to.deep.equal(["text", "key"]);
    expect(terminal.anchor).to.equal(null);
    input.type("\x03");
    expect(quit).toHaveBeenCalledTimes(1);
    close();
    close();
    await nextFrame();
    expect(terminal.band).to.equal(null);
    const shown = await screen(stdout.written);
    expect(shown.join("\n")).to.not.include("bande");
    expect(shown.join("\n")).to.include("ligne 20");
    terminal.close();
  });

  it("--mouse : un clic sur la bande lui arrive en coordonnées LOCALES et ne traverse pas ; la molette non plus ; hors d'elle, la souris atteint le journal", async () => {
    const { stdout, input, terminal } = fullscreen({ mouse: true });
    terminal.ingest("server", "out", lines(40));
    const { seen, band } = greedy();
    terminal.openBand(band);
    await nextFrame();
    const shown = await screen(stdout.written);
    const row = shown.indexOf("bande 2") + 1;
    expect(row).to.be.greaterThan(1);
    input.type(press(4, row) + release(4, row) + `\x1b[<64;4;${row}M`);
    await nextFrame();
    expect(seen).to.deep.equal([
      { kind: "mouse", row: 2, column: 4 },
      { kind: "mouse", row: 2, column: 4 },
      { kind: "wheel", row: 2, column: 4 },
    ]);
    expect(terminal.anchor).to.equal(null);
    input.type("\x1b[<64;4;2M");
    await nextFrame();
    expect(terminal.anchor).to.not.equal(null);
    expect(seen).to.have.length(3);
    terminal.close();
  });
});

describe("plein écran — le terminal fait défiler le journal (#903, D2)", () => {
  /** Le même scénario sur deux terminaux : défilement confié, diff seul. */
  async function both(
    steps: ReadonlyArray<(t: ReturnType<typeof fullscreen>) => void>,
  ): Promise<{ scroll: string[]; diff: string[] }> {
    const scroll = fullscreen({ paint: "scroll", mouse: true });
    const diff = fullscreen({ paint: "diff", mouse: true });
    for (const t of [scroll, diff]) t.terminal.setStatus(null, ctx, "ready");
    for (const [i, step] of steps.entries()) {
      for (const t of [scroll, diff]) step(t);
      await nextFrame();
      expect(
        await screen(scroll.stdout.written),
        `écran différent après l'étape ${i}`,
      ).to.deep.equal(await screen(diff.stdout.written));
    }
    scroll.terminal.close();
    diff.terminal.close();
    return { scroll: scroll.stdout.written, diff: diff.stdout.written };
  }

  it("rafales, molette, PgUp, Fin, sélection, onglet : l'écran est le MÊME, à chaque image", async () => {
    const { scroll, diff } = await both([
      (t) => t.terminal.ingest("server", "out", lines(30)),
      (t) => t.terminal.ingest("server", "out", lines(1, 31)),
      (t) => t.terminal.ingest("server", "out", lines(3, 32)),
      (t) => t.terminal.ingest("server", "out", "en cours"),
      (t) => t.terminal.ingest("server", "out", " fini\n"),
      (t) => t.input.type("\x1b[A\x1b[A\x1b[A"),
      (t) => t.terminal.ingest("server", "out", lines(5, 40)),
      (t) => t.input.type("\x1b[5~"),
      (t) => t.input.type("\x1b[B"),
      (t) => t.input.type(press(3, 2) + drag(8, 4)),
      (t) => t.input.type("\x1b[A"),
      (t) => t.input.type(release(8, 4) + "\x1b"),
      (t) => t.input.type("\x1b[F"),
      (t) => t.terminal.ingest("vite:app", "out", "vite prêt\n"),
      (t) => t.terminal.ingest("server", "out", lines(4, 50)),
      (t) => t.input.type("\x1b2"),
      (t) => t.input.type("\x1b1"),
      (t) => t.terminal.ingest("server", "out", lines(20, 60)),
    ]);
    const bytes = (w: readonly string[]) => w.join("").length;
    expect(bytes(scroll)).to.be.lessThan(bytes(diff));
  });

  it("une ligne arrive en direct : UN défilement borné au journal, une ligne écrite, marges remises", async () => {
    const { stdout, terminal } = fullscreen({ paint: "scroll" });
    terminal.setStatus(null, ctx, "ready");
    terminal.ingest("server", "out", lines(30));
    await nextFrame();
    const before = stdout.written.length;
    terminal.ingest("server", "out", lines(1, 31));
    await nextFrame();
    const redraw = stdout.written.slice(before).join("");
    expect(redraw).to.match(/\x1b\[0m\x1b\[1;\d+r\x1b\[1S\x1b\[r/);
    expect(redraw.match(/\x1b\[\d+;1H/g)).to.have.length(1);
    expect(redraw).to.include("ligne 31");
    terminal.close();
  });

  it("paint « full » repeint toute l'image ; « diff » ne défile jamais", async () => {
    for (const paint of ["full", "diff"] as const) {
      const { stdout, terminal } = fullscreen({ paint });
      terminal.setStatus(null, ctx, "ready");
      terminal.ingest("server", "out", lines(30));
      await nextFrame();
      const before = stdout.written.length;
      terminal.ingest("server", "out", lines(1, 31));
      await nextFrame();
      const redraw = stdout.written.slice(before).join("");
      expect(redraw, paint).to.not.match(/\x1b\[\d*S|\x1b\[1;\d+r/);
      if (paint === "full") {
        expect(redraw.match(/\x1b\[\d+;1H/g)).to.have.length(ROWS);
      }
      terminal.close();
    }
  });

  it("la sortie remet les marges avant de quitter l'écran alternatif", () => {
    const { stdout, terminal } = fullscreen();
    terminal.close();
    const out = stdout.written.join("");
    expect(out.indexOf("\x1b[r")).to.be.greaterThan(-1);
    expect(out.indexOf("\x1b[r")).to.be.lessThan(out.indexOf("\x1b[?1049l"));
  });
});

describe("plein écran — le mode de dessin, garde-fou ConPTY (#903, D3)", () => {
  it("rien demandé : défilement sous macOS et Linux ; sous Windows, image repeinte entière, et c'est DIT", () => {
    for (const platform of ["darwin", "linux"]) {
      expect(readDevPaint({}, platform)).to.deep.equal({
        paint: "scroll",
        reason: null,
        invalid: null,
      });
    }
    const windows = readDevPaint({}, "win32");
    expect(windows.paint).to.equal("full");
    expect(windows.reason).to.include("ConPTY");
    expect(windows.reason).to.include("NF_DEV_PAINT=scroll");
  });

  it("NF_DEV_PAINT l'emporte, Windows compris — c'est la porte du banc à la main", () => {
    for (const paint of ["scroll", "diff", "full"] as const) {
      expect(readDevPaint({ NF_DEV_PAINT: paint }, "win32")).to.deep.equal({
        paint,
        reason: null,
        invalid: null,
      });
    }
  });

  it("une valeur qui n'est pas un mode est NOMMÉE, et le défaut s'applique", () => {
    expect(readDevPaint({ NF_DEV_PAINT: "rapide" }, "linux")).to.deep.equal({
      paint: "scroll",
      reason: null,
      invalid: "rapide",
    });
    expect(readDevPaint({ NF_DEV_PAINT: "" }, "linux").invalid).to.equal(null);
    expect(readDevPaint({ NF_DEV_PAINT: "rapide" }, "win32").paint).to.equal(
      "full",
    );
  });
});

describe("plein écran — image retenue tant que le terminal ne suit pas (#903, D6)", () => {
  /** Un flux qui accepte, ou dit « plein » jusqu'au prochain `drain`. */
  function slowOutput() {
    const events = new EventEmitter();
    const written: string[] = [];
    let full = false;
    return {
      columns: COLS,
      rows: ROWS,
      written,
      fill: () => (full = true),
      drain: () => {
        full = false;
        events.emit("drain");
      },
      listeners: () => events.listenerCount("drain"),
      write: (chunk: string | Uint8Array): boolean => {
        written.push(String(chunk));
        return !full;
      },
      once: (event: "drain", listener: () => void) =>
        events.once(event, listener),
      removeListener: (event: "drain", listener: () => void) =>
        events.removeListener(event, listener),
    };
  }
  function slowFullscreen() {
    const stdout = slowOutput();
    const terminal = new DevTerminal({
      stdout,
      color: false,
      charset: "unicode",
      mark: brandMark("unicode", false),
      fullscreen: {
        input: new FakeInput(),
        synchronized: false,
        onQuit: vi.fn(),
      },
    });
    terminal.setStatus(null, ctx, "ready");
    return { stdout, terminal };
  }

  it("write rend false : plus aucune image avant drain, puis UNE image qui rend tout", async () => {
    const { stdout, terminal } = slowFullscreen();
    terminal.ingest("server", "out", lines(3));
    await nextFrame();
    stdout.fill();
    terminal.ingest("server", "out", lines(1, 4)); // cette image remplit le tampon
    await nextFrame();
    const held = stdout.written.length;
    expect(stdout.listeners()).to.equal(1);
    for (let i = 5; i < 9; i++) {
      terminal.ingest("server", "out", lines(1, i));
      await nextFrame();
    }
    expect(stdout.written.length, "image partie sans drain").to.equal(held);
    stdout.drain();
    await nextFrame();
    expect(stdout.written.length).to.equal(held + 1);
    expect((await screen(stdout.written)).slice(0, 8)).to.deep.equal(
      Array.from({ length: 8 }, (_, i) => `ligne ${i + 1}`),
    );
    expect(stdout.listeners()).to.equal(0);
    terminal.close();
  });

  it("fermé pendant l'attente : l'écouteur drain est retiré, un drain tardif ne dessine rien", async () => {
    const { stdout, terminal } = slowFullscreen();
    stdout.fill();
    terminal.ingest("server", "out", lines(2));
    await nextFrame();
    expect(stdout.listeners()).to.equal(1);
    terminal.close();
    expect(stdout.listeners()).to.equal(0);
    const after = stdout.written.length;
    stdout.drain();
    await nextFrame();
    expect(stdout.written.length).to.equal(after);
  });
});
