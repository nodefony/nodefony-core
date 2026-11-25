/**
 * L'invite branchée dans le plein écran (#538, lot 1a) : un faux clavier, un
 * vrai émulateur (`@xterm/headless`) pour lire l'écran, et un projet jetable
 * pour l'historique.
 */
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import xterm from "@xterm/headless";
import { afterAll, describe, expect, it, vi } from "vitest";
import { brandMark } from "../cli/brand";
import { DevTerminal } from "../service/dev/DevTerminal";
import { supervisorActions } from "../service/dev/promptAction";
import { PROMPT_HISTORY_FILE } from "../service/dev/promptHistory";

const COLS = 60;
const ROWS = 24;
const ENTER = "\r";
const UP = "\x1b[A";
const PGUP = "\x1b[5~";
const CTRL_C = "\x03";
const ALT_2 = "\x1b2";

class FakeInput extends EventEmitter {
  setRawMode(): this {
    return this;
  }
  resume(): this {
    return this;
  }
  pause(): this {
    return this;
  }
  type(bytes: string): void {
    this.emit("data", Buffer.from(bytes));
  }
}

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

function prompted(mouse = false, columns = COLS, rows = ROWS) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nf-dev-prompt-"));
  roots.push(root);
  const written: string[] = [];
  const stdout = {
    columns,
    rows,
    write: (chunk: string | Uint8Array): boolean => {
      written.push(String(chunk));
      return true;
    },
  };
  const input = new FakeInput();
  const quit = vi.fn();
  const terminal = new DevTerminal({
    stdout,
    color: false,
    charset: "unicode",
    mark: brandMark("unicode", false),
    fullscreen: { input, synchronized: false, onQuit: quit, mouse },
  });
  const verbs = {
    restart: vi.fn(async () => true),
    clear: vi.fn(),
    help: vi.fn(() => terminal.showHelp()),
    quit: vi.fn(),
  };
  const detach = terminal.attachPrompt({
    root,
    actions: supervisorActions(verbs),
  });
  return { root, written, input, quit, terminal, verbs, detach };
}

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 40));

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

describe("plein écran — l'invite (#538)", () => {
  it("en bas : un filet, puis l'invite et son texte d'aide, le curseur dessus", async () => {
    const { written, terminal } = prompted();
    await nextFrame();
    const lines = await screen(written);
    expect(lines.at(-2)).to.equal("─".repeat(COLS - 1));
    expect(
      lines.at(-1)?.startsWith("❯  restart · clear · help · quit"),
    ).to.equal(true);
    // Le curseur est montré, sur la colonne après le signe.
    expect(written.join("")).to.contain(`\x1b[${ROWS};3H\x1b[?25h`);
    terminal.close();
  });

  it("Entrée lance le verbe, l'écho passe au journal, la saisie part à l'historique du projet", async () => {
    const { root, written, input, terminal, verbs } = prompted();
    input.type("clear" + ENTER);
    await nextFrame();
    expect(verbs.clear).toHaveBeenCalledTimes(1);
    const lines = await screen(written);
    expect(lines.some((line) => line === "❯ clear")).to.equal(true);
    await terminal.flushPrompt();
    const saved = fs.readFileSync(path.join(root, PROMPT_HISTORY_FILE), "utf8");
    expect(saved).to.contain('"t":"clear"');
    terminal.close();
  });

  it("une saisie inconnue le dit, sans rien lancer", async () => {
    const { written, input, terminal, verbs } = prompted();
    input.type("frobnicate now" + ENTER);
    await nextFrame();
    const lines = await screen(written);
    expect(
      lines.some((l) => l.startsWith("commande inconnue : frobnicate")),
    ).to.equal(true);
    expect(verbs.clear).not.toHaveBeenCalled();
    terminal.close();
  });

  it("↑ rappelle la saisie précédente et ne fait PAS défiler le journal ; PgUp, si", async () => {
    const { input, terminal } = prompted();
    for (let i = 0; i < 40; i++)
      terminal.ingest("server", "out", `ligne ${i}\n`);
    input.type("clear" + ENTER);
    await terminal.flushPrompt();
    input.type(UP);
    expect(terminal.anchor).to.equal(null);
    await nextFrame();
    // Rien à rappeler de plus ancien : ↑ reste à l'invite.
    input.type(UP);
    expect(terminal.anchor).to.equal(null);
    input.type(PGUP);
    expect(terminal.anchor).to.not.equal(null);
    terminal.close();
  });

  it("↑ après un envoi montre la saisie rappelée sur l'invite", async () => {
    const { written, input, terminal } = prompted();
    input.type("clear" + ENTER);
    await terminal.flushPrompt();
    input.type(UP);
    await nextFrame();
    const lines = await screen(written);
    expect(lines.at(-1)).to.equal("❯ clear");
    terminal.close();
  });

  it("Ctrl+C efface une saisie ; sur une invite vide, il demande l'arrêt", async () => {
    const { written, input, quit, terminal } = prompted();
    input.type("rest" + CTRL_C);
    expect(quit).not.toHaveBeenCalled();
    await nextFrame();
    const lines = await screen(written);
    expect(lines.at(-1)?.startsWith("❯  restart")).to.equal(true);
    input.type(CTRL_C);
    expect(quit).toHaveBeenCalledTimes(1);
    terminal.close();
  });

  it("`?` ouvre l'aide sur une invite vide, et s'écrit dans une saisie", async () => {
    const { written, input, terminal } = prompted();
    input.type("a?");
    expect(terminal.band).to.equal(null);
    input.type(CTRL_C + "?");
    expect(terminal.band).to.not.equal(null);
    await nextFrame();
    const lines = await screen(written);
    expect(lines.join("\n")).to.contain("historique de l'invite");
    terminal.close();
  });

  it("une bande ouverte garde le clavier AVANT l'invite (D9) : `q` ferme l'aide, il ne s'écrit pas", async () => {
    const { written, input, terminal } = prompted();
    input.type("?");
    expect(terminal.band).to.not.equal(null);
    input.type("q");
    expect(terminal.band).to.equal(null);
    await nextFrame();
    expect((await screen(written)).at(-1)?.startsWith("❯  restart")).to.equal(
      true,
    );
    terminal.close();
  });

  it("un brouillon par onglet : changer d'onglet ne le perd pas", async () => {
    const { written, input, terminal } = prompted();
    terminal.ingest("server", "out", "prêt\n");
    terminal.addView({ id: "run:1", title: "run", channels: "run:1" });
    input.type("brouillon");
    input.type(ALT_2);
    await nextFrame();
    expect((await screen(written)).at(-1)?.startsWith("❯  restart")).to.equal(
      true,
    );
    input.type("\x1b1");
    await nextFrame();
    expect((await screen(written)).at(-1)).to.equal("❯ brouillon");
    terminal.close();
  });

  it("action en vol : Ctrl+C l'interrompt, un second Ctrl+C arrête quand même", async () => {
    const { input, quit, terminal, verbs } = prompted();
    verbs.restart.mockImplementation(() => new Promise<boolean>(() => {}));
    input.type("restart" + ENTER);
    await nextFrame();
    input.type(CTRL_C);
    expect(quit).not.toHaveBeenCalled();
    input.type(CTRL_C);
    expect(quit).toHaveBeenCalledTimes(1);
    terminal.close();
  });

  it("l'écho d'un long collage montre son étiquette, pas son texte", async () => {
    const { written, input, terminal } = prompted();
    input.type(`\x1b[200~l1\nl2\nl3\nl4\nl5\nl6\x1b[201~${ENTER}`);
    await nextFrame();
    const lines = await screen(written);
    expect(lines.some((l) => l === "❯ [Collé #1 · 6 lignes]")).to.equal(true);
    expect(lines.some((l) => l === "l3")).to.equal(false);
    terminal.close();
  });

  it("clearView vide l'onglet AFFICHÉ, quel qu'il soit", async () => {
    const { written, input, terminal } = prompted();
    terminal.ingest("server", "out", "prêt\n");
    terminal.addView({ id: "run:1", title: "run", channels: "run:1" });
    terminal.ingest("run:1", "out", "sortie de run\n");
    input.type(ALT_2);
    await nextFrame();
    expect((await screen(written)).some((l) => l === "sortie de run")).to.equal(
      true,
    );
    terminal.clearView();
    await nextFrame();
    expect((await screen(written)).some((l) => l === "sortie de run")).to.equal(
      false,
    );
    terminal.close();
  });

  it("souris captée : un clic sur un onglet le montre, invite branchée", async () => {
    const { written, input, terminal } = prompted(true);
    terminal.ingest("server", "out", "prêt\n");
    terminal.addView({ id: "run:1", title: "run", channels: "run:1" });
    terminal.ingest("run:1", "out", "sortie de run\n");
    await nextFrame();
    const lines = await screen(written);
    const row = lines.findIndex(
      (l) => l.includes("run") && l.includes("serveur"),
    );
    expect(row, lines.join("\n")).to.be.greaterThan(-1);
    const column = (lines[row] ?? "").indexOf("run") + 1;
    input.type(`\x1b[<0;${column};${row + 1}M\x1b[<0;${column};${row + 1}m`);
    await nextFrame();
    expect(terminal.activeView).to.equal("run:1");
    terminal.close();
  });

  it("souris captée, décor réel (120×30, barre d'état, journal plein) : le clic montre l'onglet", async () => {
    const { written, input, terminal } = prompted(true, 120, 30);
    terminal.setStatus(
      null,
      { project: "mon-app", readyAt: "16:48", reloads: 0 },
      "ready",
    );
    for (let i = 0; i < 80; i++)
      terminal.ingest("server", "out", `ligne ${i}\n`);
    terminal.ingest("vite:app", "out", "vite prêt\n");
    await nextFrame();
    const lines = await screen(written, 120, 30);
    const row = lines.findIndex(
      (l) => l.includes("serveur") && l.includes("vite"),
    );
    expect(row, lines.join("\n")).to.be.greaterThan(-1);
    const column = (lines[row] ?? "").indexOf("vite") + 1;
    input.type(`\x1b[<0;${column};${row + 1}M\x1b[<0;${column};${row + 1}m`);
    await nextFrame();
    expect(terminal.activeView, lines.join("\n")).to.equal("vite");
    terminal.close();
  });

  it("retirée, l'invite rend la place et les touches au journal", async () => {
    const { input, terminal, detach } = prompted();
    for (let i = 0; i < 40; i++)
      terminal.ingest("server", "out", `ligne ${i}\n`);
    detach();
    input.type(UP);
    expect(terminal.anchor).to.not.equal(null);
    terminal.close();
  });
});
