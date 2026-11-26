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
import {
  cliCommandAction,
  type IPromptAction,
  type IPromptIO,
  supervisorActions,
} from "../service/dev/promptAction";
import { buildPromptMenu } from "../service/dev/devMenuBand";
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

const MANIFEST = {
  version: "0.0.0",
  globalOptions: [],
  commands: [
    {
      name: "build",
      aliases: [],
      description: "compile modules puis application",
      options: ["--force", "--force-all"],
      group: "GÉNÉRER ET CONSTRUIRE",
    },
    {
      name: "inspect",
      aliases: [],
      description: "l'état réel de l'application",
      options: [],
      group: "COMPRENDRE",
    },
  ],
};

function prompted(
  mouse = false,
  columns = COLS,
  rows = ROWS,
  menu = false,
  extra: readonly IPromptAction[] = [],
) {
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
    status: vi.fn(async () => {}),
  };
  const detach = terminal.attachPrompt({
    root,
    actions: [
      ...supervisorActions(verbs),
      ...extra,
      cliCommandAction(() => MANIFEST),
    ],
    ...(menu
      ? {
          menu: () =>
            buildPromptMenu({
              manifest: MANIFEST,
              inspectSubjects: { routes: { summary: "les routes montées" } },
            }),
        }
      : {}),
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
  it("en bas : un filet, puis l'invite VIDE — rien que le curseur, aucun texte d'exemple", async () => {
    const { written, terminal } = prompted();
    await nextFrame();
    const lines = await screen(written);
    expect(lines.at(-2)).to.equal("─".repeat(COLS - 1));
    expect(lines.at(-1)).to.equal("❯ ");
    // Le curseur est montré, sur la colonne après le signe.
    expect(written.join("")).to.contain(`\x1b[${ROWS};3H\x1b[?25h`);
    terminal.close();
  });

  it("Entrée lance le verbe, l'écho passe au journal, la saisie part à l'historique du projet", async () => {
    const { root, written, input, terminal, verbs } = prompted();
    input.type("/clear" + ENTER);
    await nextFrame();
    expect(verbs.clear).toHaveBeenCalledTimes(1);
    const lines = await screen(written);
    expect(lines.some((line) => line === "❯ /clear")).to.equal(true);
    await terminal.flushPrompt();
    const saved = fs.readFileSync(path.join(root, PROMPT_HISTORY_FILE), "utf8");
    expect(saved).to.contain('"t":"/clear"');
    terminal.close();
  });

  it("une saisie inconnue le dit, sans rien lancer ; un verbe sans `/` n'est pas le verbe", async () => {
    const { written, input, terminal, verbs } = prompted();
    input.type("/frobnicate now" + ENTER);
    await nextFrame();
    input.type("clear" + ENTER);
    await nextFrame();
    const lines = await screen(written);
    expect(
      lines.some((l) => l.startsWith("commande inconnue : /frobnicate")),
    ).to.equal(true);
    expect(
      lines.some((l) => l.startsWith("les commandes commencent par « / »")),
    ).to.equal(true);
    expect(verbs.clear).not.toHaveBeenCalled();
    terminal.close();
  });

  it("↑ rappelle la saisie précédente et ne fait PAS défiler le journal ; PgUp, si", async () => {
    const { input, terminal } = prompted();
    for (let i = 0; i < 40; i++)
      terminal.ingest("server", "out", `ligne ${i}\n`);
    input.type("/clear" + ENTER);
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
    input.type("/clear" + ENTER);
    await terminal.flushPrompt();
    input.type(UP);
    await nextFrame();
    const lines = await screen(written);
    expect(lines.at(-1)).to.equal("❯ /clear");
    terminal.close();
  });

  it("Ctrl+C efface une saisie ; sur une invite vide, il demande l'arrêt", async () => {
    const { written, input, quit, terminal } = prompted();
    input.type("rest" + CTRL_C);
    expect(quit).not.toHaveBeenCalled();
    await nextFrame();
    const lines = await screen(written);
    expect(lines.at(-1)).to.equal("❯ ");
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
    expect((await screen(written)).at(-1)).to.equal("❯ ");
    terminal.close();
  });

  it("un brouillon par onglet : changer d'onglet ne le perd pas", async () => {
    const { written, input, terminal } = prompted();
    terminal.ingest("server", "out", "prêt\n");
    terminal.addView({ id: "run:1", title: "run", channels: "run:1" });
    input.type("brouillon");
    input.type(ALT_2);
    await nextFrame();
    expect((await screen(written)).at(-1)).to.equal("❯ ");
    input.type("\x1b1");
    await nextFrame();
    expect((await screen(written)).at(-1)).to.equal("❯ brouillon");
    terminal.close();
  });

  it("action en vol : Ctrl+C l'interrompt, un second Ctrl+C arrête quand même", async () => {
    const { input, quit, terminal, verbs } = prompted();
    verbs.restart.mockImplementation(() => new Promise<boolean>(() => {}));
    input.type("/restart" + ENTER);
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

  it("l'écho et la sortie de l'invite restent dans l'onglet qui a le focus, pas dans « serveur »", async () => {
    const { written, input, terminal } = prompted();
    terminal.ingest("server", "out", "prêt\n");
    terminal.addView({ id: "run:1", title: "run", channels: "run:1" });
    input.type(ALT_2);
    await nextFrame();
    input.type("/frobnicate" + ENTER);
    await nextFrame();
    const focused = await screen(written);
    expect(focused.some((l) => l === "❯ /frobnicate")).to.equal(true);
    expect(
      focused.some((l) => l.startsWith("commande inconnue : /frobnicate")),
    ).to.equal(true);
    input.type("\x1b1");
    await nextFrame();
    const server = await screen(written);
    expect(server.some((l) => l === "prêt")).to.equal(true);
    expect(server.some((l) => l === "❯ /frobnicate")).to.equal(false);
    expect(server.some((l) => l.startsWith("commande inconnue"))).to.equal(
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

  it("souris NON captée (iTerm2 sans « mouse reporting ») : un cran de molette — une rafale de flèches — défile le journal, pas l'historique", async () => {
    const { input, terminal } = prompted();
    for (let i = 0; i < 40; i++)
      terminal.ingest("server", "out", `ligne ${i}\n`);
    input.type("/clear" + ENTER);
    await terminal.flushPrompt();
    // Un cran traduit par le terminal : trois flèches dans UN paquet.
    input.type(UP + UP + UP);
    expect(terminal.anchor).to.not.equal(null);
    await nextFrame();
    // La flèche suivante, tapée seule, défile encore : le focus est au journal.
    const before = terminal.anchor;
    input.type(UP);
    expect(terminal.anchor).to.not.deep.equal(before);
    terminal.close();
  });

  it("focus : la frappe le rend à l'invite, ↑ y rappelle l'historique ; curseur masqué quand il est au journal", async () => {
    const { written, input, terminal } = prompted();
    for (let i = 0; i < 200; i++)
      terminal.ingest("server", "out", `ligne ${i}\n`);
    input.type("/clear" + ENTER);
    await terminal.flushPrompt();
    input.type(PGUP);
    await nextFrame();
    const hidden = written.length;
    input.type(UP);
    await nextFrame();
    expect(written.slice(hidden).join("")).to.not.contain("\x1b[?25h");
    input.type("x");
    await nextFrame();
    expect(written.slice(hidden).join("")).to.contain("\x1b[?25h");
    // Saisie « x » : rien ne la prolonge, ↑ reste à l'invite.
    input.type(CTRL_C + UP);
    await nextFrame();
    expect((await screen(written)).at(-1)).to.equal("❯ /clear");
    terminal.close();
  });

  it("souris captée : un clic dans le journal y met le focus, un clic sur l'invite l'y rend", async () => {
    const { written, input, terminal } = prompted(true);
    for (let i = 0; i < 40; i++)
      terminal.ingest("server", "out", `ligne ${i}\n`);
    input.type("/clear" + ENTER);
    await terminal.flushPrompt();
    await nextFrame();
    // Clic au milieu du journal, relâché aussitôt.
    input.type("\x1b[<0;5;5M\x1b[<0;5;5m");
    input.type(UP);
    expect(terminal.anchor).to.not.equal(null);
    // Clic sur la ligne de l'invite (la dernière).
    input.type(`\x1b[<0;5;${ROWS}M\x1b[<0;5;${ROWS}m`);
    input.type(UP);
    await nextFrame();
    expect((await screen(written)).at(-1)).to.equal("❯ /clear");
    terminal.close();
  });

  it("capture demandée mais molette reçue en flèches : le refus du terminal est DIT, une fois", async () => {
    const { written, input, terminal } = prompted(true, 120, 30);
    terminal.setStatus(
      null,
      { project: "mon-app", readyAt: "16:48", reloads: 0 },
      "ready",
    );
    for (let i = 0; i < 80; i++)
      terminal.ingest("server", "out", `ligne ${i}\n`);
    input.type(UP + UP + UP);
    await nextFrame();
    const text = (await screen(written, 120, 30)).join("\n");
    expect(text).to.contain("le terminal ne rapporte pas la souris");
    terminal.close();
  });

  it("souris rapportée : aucun avertissement, même sur une rafale de flèches", async () => {
    const { written, input, terminal } = prompted(true, 120, 30);
    terminal.setStatus(
      null,
      { project: "mon-app", readyAt: "16:48", reloads: 0 },
      "ready",
    );
    input.type("\x1b[<64;5;5M");
    input.type(UP + UP + UP);
    await nextFrame();
    const text = (await screen(written, 120, 30)).join("\n");
    expect(text).to.not.contain("le terminal ne rapporte pas la souris");
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

describe("plein écran — le panneau à rubriques (#538, D9)", () => {
  const RIGHT = "\x1b[C";
  const LEFT = "\x1b[D";
  const ESC = "\x1b";
  const panel = (value = "un", module = "chargé") => ({
    id: "status",
    label: "status",
    pages: [
      {
        title: "Serveur",
        rows: [{ kind: "entry" as const, key: "état", value }],
      },
      {
        title: "Modules",
        rows: [{ kind: "entry" as const, key: "http", value: module }],
      },
    ],
  });

  it("s'ouvre dans un onglet à la volée, à la place du journal ; Échap le referme", async () => {
    const { written, input, terminal } = prompted();
    terminal.ingest("server", "out", "prêt\n");
    terminal.openPanel(panel());
    await nextFrame();
    let lines = await screen(written);
    expect(lines.slice(0, 3)).to.deep.equal([
      " Serveur   Modules ",
      "─".repeat(COLS - 1),
      "  état  un",
    ]);
    expect(lines).to.include("←→ rubrique · Échap fermer");
    expect(lines).to.include(" 1 serveur ·1 ┃[2 status]│");
    expect(lines.some((l) => l.includes("prêt"))).to.equal(false);
    // Un Échap seul attend la fin du délai d'ambiguïté du décodeur : on attend
    // le FAIT (journal revenu), jamais une durée — un runner lent la dépasse.
    input.type(ESC);
    await vi.waitFor(async () => {
      const shown = await screen(written);
      expect(shown.some((l) => l.includes("prêt"))).to.equal(true);
    });
    lines = await screen(written);
    expect(lines.some((l) => l.includes("prêt"))).to.equal(true);
    expect(lines.some((l) => l.includes("2 status"))).to.equal(false);
    terminal.close();
  });

  it("→ change de rubrique sur une saisie vide ; dès qu'on tape, ←→ reviennent à l'éditeur", async () => {
    const { written, input, terminal } = prompted();
    terminal.openPanel(panel());
    input.type(RIGHT);
    await nextFrame();
    expect(await screen(written)).to.include("  http  chargé");
    input.type("ab" + LEFT + LEFT + "c");
    await nextFrame();
    const lines = await screen(written);
    expect(lines.at(-1)).to.equal("❯ cab");
    expect(lines).to.include("  http  chargé");
    terminal.close();
  });

  it("rouvert sous le même identifiant : un seul onglet, contenu remplacé, rubrique gardée", async () => {
    const { written, input, terminal } = prompted();
    terminal.openPanel(panel("un"));
    input.type(RIGHT);
    terminal.openPanel(panel("deux", "rechargé"));
    await nextFrame();
    const lines = await screen(written);
    expect(lines).to.include("  http  rechargé");
    expect(lines.filter((l) => l.includes("status]"))).to.have.length(1);
    terminal.close();
  });

  it("/help ouvre l'aide COMPLÈTE en panneau ; ? garde la bande des gestes", async () => {
    const { written, input, terminal } = prompted();
    input.type("/help" + ENTER);
    await nextFrame();
    let lines = await screen(written);
    expect(lines[0]).to.equal(" Invite   CLI ");
    expect(lines).to.include("Commandes de l'invite");
    expect(lines.some((l) => l.includes("[2 aide]"))).to.equal(true);
    input.type("\x1b");
    // Échap seul : attendre que le panneau soit FERMÉ, pas une durée.
    await vi.waitFor(async () => {
      const shown = await screen(written);
      expect(shown.some((l) => l.includes("[2 aide]"))).to.equal(false);
    });
    input.type("?");
    await nextFrame();
    lines = await screen(written);
    expect(lines.some((l) => l.startsWith(" Gestes"))).to.equal(true);
    expect(lines.some((l) => l.includes("aide]"))).to.equal(false);
    terminal.close();
  });
});

describe("plein écran — la bande /nodefony (#538, D9, D10)", () => {
  const BACKSPACE = "\x7f";
  const ESCAPE = "\x1b";
  const CTRL_U = "\x15";
  const withMenu = () => prompted(false, COLS, ROWS, true);

  it("« / » l'ouvre au-dessus de l'invite ; Retour arrière jusqu'au vide la referme", async () => {
    const { written, input, terminal } = withMenu();
    input.type("/");
    expect(terminal.band).to.not.equal(null);
    await nextFrame();
    const lines = await screen(written);
    expect(
      lines.some((l) => l.startsWith("── /nodefony · ↑↓ choisir")),
    ).to.equal(true);
    expect(lines.some((l) => l.startsWith("    ▸ /status"))).to.equal(true);
    input.type(BACKSPACE);
    expect(terminal.band).to.equal(null);
    terminal.close();
  });

  it("sans menu fourni : aucune bande", () => {
    const { input, terminal } = prompted();
    input.type("/");
    expect(terminal.band).to.equal(null);
    terminal.close();
  });

  it("Entrée lance l'entrée choisie : « /cl » envoie /clear, la bande se referme", async () => {
    const { written, input, terminal, verbs } = withMenu();
    input.type("/cl" + ENTER);
    await nextFrame();
    expect(verbs.clear).toHaveBeenCalledTimes(1);
    expect(terminal.band).to.equal(null);
    expect((await screen(written)).some((l) => l === "❯ /clear")).to.equal(
      true,
    );
    terminal.close();
  });

  it("Échap la retire tant que la saisie reste sous « / » ; vidée, « / » la rouvre", async () => {
    const { input, terminal } = withMenu();
    input.type("/c");
    input.type(ESCAPE);
    // Échap seul : attendre la bande RETIRÉE, pas une durée.
    await vi.waitFor(() => expect(terminal.band).to.equal(null));
    input.type("l");
    expect(terminal.band).to.equal(null);
    input.type(CTRL_U);
    input.type("/");
    expect(terminal.band).to.not.equal(null);
    terminal.close();
  });

  it("« /nodefony insp » + Entrée ouvre les sujets d'inspect ; Entrée lance le choisi", async () => {
    const { written, input, terminal } = withMenu();
    input.type("/nodefony insp" + ENTER);
    await nextFrame();
    expect(terminal.band).to.not.equal(null);
    expect(
      (await screen(written)).some((l) => l.includes("Inspecter quoi ?")),
    ).to.equal(true);
    input.type(ENTER);
    await nextFrame();
    const lines = await screen(written);
    expect(lines.some((l) => l === "❯ /nodefony inspect routes")).to.equal(
      true,
    );
    expect(lines.some((l) => l.includes("ne se lance pas encore"))).to.equal(
      true,
    );
    terminal.close();
  });

  it("passé la commande, la bande s'efface : Entrée envoie la ligne ENTIÈRE, options comprises", async () => {
    const { written, input, terminal } = withMenu();
    input.type("/nodefony build --f");
    expect(terminal.band).to.equal(null);
    input.type(ENTER);
    await nextFrame();
    expect(
      (await screen(written)).some((l) => l === "❯ /nodefony build --f"),
    ).to.equal(true);
    terminal.close();
  });
});

describe("plein écran — Tab et Ctrl+R (#538, D11, D12)", () => {
  const TAB = "\t";
  const CTRL_R = "\x12";
  const ESCAPE = "\x1b";
  const promptLine = async (
    written: readonly string[],
    cols = COLS,
    rows = ROWS,
  ) =>
    (await screen(written, cols, rows)).find((l) => l.startsWith("❯ ")) ?? "";

  it("Tab complète une option par computeCompletions ; la bande reste effacée", async () => {
    const { written, input, terminal } = prompted(false, 120, 30, true);
    terminal.setStatus(
      null,
      { project: "mon-app", readyAt: "16:48", reloads: 0 },
      "ready",
    );
    input.type("/nodefony build --fo");
    input.type(TAB);
    await nextFrame();
    // Deux candidats : leur début commun, sans blanc.
    expect(await promptLine(written, 120, 30)).to.equal(
      "❯ /nodefony build --force",
    );
    expect(terminal.band).to.equal(null);
    input.type(TAB);
    await nextFrame();
    // Le début commun n'avance plus : Tab MONTRE les propositions.
    expect(terminal.band).to.not.equal(null);
    expect(
      (await screen(written, 120, 30)).some((l) => l === "  --force-all"),
    ).to.equal(true);
    input.type("-");
    await nextFrame();
    expect(terminal.band).to.not.equal(null);
    input.type(TAB);
    await nextFrame();
    // Un seul choix : un blanc derrière, comme le shell ; la bande se ferme.
    expect(await promptLine(written, 120, 30)).to.equal(
      "❯ /nodefony build --force-all ",
    );
    expect(terminal.band).to.equal(null);
    terminal.close();
  });

  it("« /nodefon » + Tab complète LE MOT, comme un shell — jamais une commande choisie au hasard", async () => {
    const { written, input, terminal } = prompted(false, 120, 30, true);
    input.type("/nodefon");
    expect(terminal.band).to.not.equal(null);
    input.type(TAB);
    await nextFrame();
    expect(await promptLine(written, 120, 30)).to.equal("❯ /nodefony ");
    // « b » filtre la bande ; Tab écrit la seule qui reste.
    input.type("b" + TAB);
    await nextFrame();
    expect(await promptLine(written, 120, 30)).to.equal("❯ /nodefony build ");
    terminal.close();
  });

  it("plus rien à compléter : Tab PARCOURT la bande /nodefony — une seule liste, jamais deux", async () => {
    const { written, input, terminal } = prompted(false, 120, 30, true);
    input.type("/nodefony ");
    const band = terminal.band;
    input.type(TAB);
    await nextFrame();
    const first = await promptLine(written, 120, 30);
    expect(first).to.match(/^❯ \/nodefony (build|inspect)$/);
    // La même bande, pas une seconde liste par-dessus.
    expect(terminal.band).to.equal(band);
    const lines = await screen(written, 120, 30);
    expect(lines.some((l) => l.startsWith("── Tab ·"))).to.equal(false);
    input.type(TAB);
    await nextFrame();
    const second = await promptLine(written, 120, 30);
    expect(second).to.match(/^❯ \/nodefony (build|inspect)$/);
    expect(second).to.not.equal(first);
    input.type("\x1b[Z");
    await nextFrame();
    expect(await promptLine(written, 120, 30)).to.equal(first);
    terminal.close();
  });

  it("dans une bande ouverte, ↓ redessine TOUT DE SUITE — pas à l'évènement suivant", async () => {
    const { written, input, terminal } = prompted(false, 120, 30, true);
    input.type("/nodefony build ");
    input.type(TAB);
    await nextFrame();
    await nextFrame();
    expect(
      (await screen(written, 120, 30)).some((l) => l === "▸ --force"),
    ).to.equal(true);
    input.type("\x1b[B");
    await nextFrame();
    expect(
      (await screen(written, 120, 30)).some((l) => l === "▸ --force-all"),
    ).to.equal(true);
    terminal.close();
  });

  it("mot en cours VIDE : Tab montre les propositions, n'en écrit aucune ; la frappe qui n'en laisse plus aucune la ferme", async () => {
    const { written, input, terminal } = prompted(false, 120, 30, true);
    input.type("/nodefony build ");
    input.type(TAB);
    await nextFrame();
    // La saisie reste telle quelle : aucune proposition écrite à l’aveugle.
    expect(await promptLine(written, 120, 30)).to.equal("❯ /nodefony build ");
    const lines = await screen(written, 120, 30);
    expect(lines.some((l) => l.startsWith("── Tab · 2 propositions"))).to.equal(
      true,
    );
    expect(lines.some((l) => l === "▸ --force")).to.equal(true);
    input.type("x");
    expect(terminal.band).to.equal(null);
    terminal.close();
  });

  it("bande retirée par Échap : Tab complète le verbe ; rien à compléter, la barre le dit", async () => {
    const { written, input, terminal } = prompted(false, 120, 30, true);
    // La barre d’état porte les messages passagers.
    terminal.setStatus(
      null,
      { project: "mon-app", readyAt: "16:48", reloads: 0 },
      "ready",
    );
    input.type("/res");
    input.type(ESCAPE);
    // Échap seul : attendre la bande RETIRÉE, pas une durée.
    await vi.waitFor(() => expect(terminal.band).to.equal(null));
    input.type(TAB);
    await nextFrame();
    expect(await promptLine(written, 120, 30)).to.equal("❯ /restart ");
    input.type("\x15zz" + TAB);
    await nextFrame();
    expect((await screen(written, 120, 30)).join("\n")).to.contain(
      "Tab : rien à compléter",
    );
    terminal.close();
  });

  it("Ctrl+R cherche dans l'historique ; Entrée REPREND la saisie sans la relancer", async () => {
    const { written, input, terminal, verbs } = prompted();
    input.type("/clear" + ENTER);
    input.type("/restart" + ENTER);
    input.type(CTRL_R);
    expect(terminal.band).to.not.equal(null);
    input.type("cl");
    await nextFrame();
    expect(
      (await screen(written)).some((l) => l.startsWith("▸ /clear")),
    ).to.equal(true);
    input.type(ENTER);
    expect(terminal.band).to.equal(null);
    expect(verbs.clear).toHaveBeenCalledTimes(1);
    await nextFrame();
    expect(await promptLine(written)).to.equal("❯ /clear");
    input.type(ENTER);
    expect(verbs.clear).toHaveBeenCalledTimes(2);
    terminal.close();
  });
});

/**
 * Une commande pilotée par le test : `/fake <titre>` ouvre l'onglet `<titre>`,
 * et ne finit que quand le test le dit — ou quand on l'interrompt (130).
 */
function launcher() {
  const runs: {
    input: string;
    io: IPromptIO;
    signal: AbortSignal;
    done: (code: number) => void;
  }[] = [];
  const action: IPromptAction = {
    id: "fake",
    matches: (input) => /^\/fake(\s|$)/.test(input.trim()),
    tabTitle: (input) => input.trim().split(/\s+/)[1] ?? "fake",
    run: (input, io, signal) =>
      new Promise<number>((resolve) => {
        runs.push({ input, io, signal, done: resolve });
        signal.addEventListener("abort", () => resolve(130), { once: true });
      }),
  };
  return { action, runs };
}

describe("plein écran — un lancement, son onglet (#538, lot 2a)", () => {
  const ALT_1 = "\x1b1";
  const settle = async (): Promise<void> => {
    await nextFrame();
  };
  const tabs = (lines: readonly string[]): string =>
    lines.find((l) => l.includes("1 serveur")) ?? "";

  it("addView sans canal : la poignée écrit dans le canal au nom de l'onglet", async () => {
    const { written, input, terminal } = prompted();
    const handle = terminal.addView({ id: "agent:1", title: "agent" });
    expect(handle.channel).to.equal("agent:1");
    handle.write("bonjour\n");
    input.type(ALT_2);
    await settle();
    expect((await screen(written)).some((l) => l === "bonjour")).to.equal(true);
    handle.close();
    handle.write("après\n");
    await settle();
    expect((await screen(written)).some((l) => l === "après")).to.equal(false);
    terminal.close();
  });

  it("une action qui a son onglet l'ouvre, le montre, y garde écho et sortie ; ✓ à la fin", async () => {
    const { action, runs } = launcher();
    const { written, input, terminal } = prompted(false, COLS, ROWS, false, [
      action,
    ]);
    terminal.ingest("server", "out", "prêt\n");
    input.type("/fake build" + ENTER);
    await settle();
    expect(runs).to.have.length(1);
    runs[0]?.io.write("compilé\n");
    await settle();
    let lines = await screen(written);
    expect(lines.some((l) => l === "❯ /fake build")).to.equal(true);
    expect(lines.some((l) => l === "compilé")).to.equal(true);
    expect(lines.some((l) => l === "prêt")).to.equal(false);
    expect(tabs(lines)).to.contain("build");
    runs[0]?.done(0);
    await settle();
    expect(tabs(await screen(written))).to.match(/✓ \d+ build/);
    input.type(ALT_1);
    await settle();
    lines = await screen(written);
    expect(lines.some((l) => l === "compilé")).to.equal(false);
    expect(lines.some((l) => l === "❯ /fake build")).to.equal(false);
    terminal.close();
  });

  it("un code non nul marque ✗", async () => {
    const { action, runs } = launcher();
    const { written, input, terminal } = prompted(false, COLS, ROWS, false, [
      action,
    ]);
    input.type("/fake build" + ENTER);
    await settle();
    runs[0]?.done(2);
    await settle();
    expect(tabs(await screen(written))).to.match(/✗ \d+ build/);
    terminal.close();
  });

  it("une action par onglet : refusée dans l'onglet occupé, libre ailleurs — /status pendant un build", async () => {
    const { action, runs } = launcher();
    const { written, input, terminal, verbs } = prompted(
      false,
      COLS,
      ROWS,
      false,
      [action],
    );
    // La barre d’état porte les messages passagers.
    terminal.setStatus(
      null,
      { project: "mon-app", readyAt: "16:48", reloads: 0 },
      "ready",
    );
    input.type("/fake build" + ENTER);
    await settle();
    input.type("/fake encore" + ENTER);
    await settle();
    expect(runs).to.have.length(1);
    const refused = await screen(written);
    expect(refused.join("\n")).to.contain("une commande tourne encore");
    // La saisie refusée reste dans le tampon.
    expect(refused).to.include("❯ /fake encore");
    input.type("\x15");
    input.type(ALT_1);
    await settle();
    input.type("/status" + ENTER);
    await settle();
    expect(verbs.status).toHaveBeenCalledTimes(1);
    input.type("/fake test" + ENTER);
    await settle();
    expect(runs).to.have.length(2);
    expect(tabs(await screen(written))).to.contain("test");
    terminal.close();
  });

  it("Ctrl+C interrompt l'action de l'onglet AFFICHÉ, pas celle d'un autre", async () => {
    const { action, runs } = launcher();
    const { written, input, terminal } = prompted(false, COLS, ROWS, false, [
      action,
    ]);
    input.type("/fake un" + ENTER);
    await settle();
    input.type(ALT_1);
    await settle();
    input.type("/fake deux" + ENTER);
    await settle();
    input.type(CTRL_C);
    await settle();
    expect(runs[1]?.signal.aborted).to.equal(true);
    expect(runs[0]?.signal.aborted).to.equal(false);
    expect(tabs(await screen(written))).to.match(/✗ \d+ deux/);
    terminal.close();
  });

  it("relancée dans son onglet fini, l'action y reste ; depuis serveur, un doublon est suffixé", async () => {
    const { action, runs } = launcher();
    const { written, input, terminal } = prompted(false, COLS, ROWS, false, [
      action,
    ]);
    input.type("/fake build" + ENTER);
    await settle();
    runs[0]?.done(1);
    await settle();
    input.type("/fake build" + ENTER);
    await settle();
    expect(runs).to.have.length(2);
    let lines = await screen(written);
    expect(lines.filter((l) => l === "❯ /fake build")).to.have.length(2);
    // L'issue précédente est effacée tant que la relance tourne.
    expect(tabs(lines)).to.not.contain("✗");
    expect(tabs(lines)).to.not.contain("build 2");
    runs[1]?.done(0);
    input.type(ALT_1);
    await settle();
    input.type("/fake build" + ENTER);
    await settle();
    lines = await screen(written);
    expect(tabs(lines)).to.contain("build 2");
    terminal.close();
  });

  it("au plafond : un 5ᵉ lancement est refusé ; tous finis, le plus ancien onglet se referme", async () => {
    const { action, runs } = launcher();
    const { written, input, terminal } = prompted(false, 200, ROWS, false, [
      action,
    ]);
    // La barre d’état porte les messages passagers.
    terminal.setStatus(
      null,
      { project: "mon-app", readyAt: "16:48", reloads: 0 },
      "ready",
    );
    for (const name of ["aa", "bb", "cc", "dd", "ee"]) {
      input.type(ALT_1);
      await settle();
      input.type(`/fake ${name}` + ENTER);
      await settle();
    }
    expect(runs).to.have.length(4);
    expect((await screen(written, 200)).join("\n")).to.contain(
      "4 commandes tournent déjà",
    );
    for (const run of runs) run.done(0);
    input.type("\x15");
    input.type(ALT_1);
    await settle();
    input.type("/fake ee" + ENTER);
    await settle();
    expect(runs).to.have.length(5);
    const line = tabs(await screen(written, 200));
    expect(line).to.not.contain("aa");
    expect(line).to.contain("bb");
    expect(line).to.contain("ee");
    terminal.close();
  });
});
