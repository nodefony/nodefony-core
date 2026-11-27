/**
 * L'hôte « pied de terminal » (#538 lot 2b-1), éprouvé PAR OCTETS : le clavier
 * reçoit les octets d'un vrai terminal, et ce que l'hôte écrit passe par un
 * vrai émulateur (`@xterm/headless`) pour lire l'ÉCRAN — pas les chaînes.
 * Un rendu en place ne se juge qu'à l'écran : une remontée de curseur fausse
 * d'une ligne laisse des débris que les octets ne montrent pas.
 */
import { EventEmitter } from "node:events";
import { describe, it, expect } from "vitest";
import xterm from "@xterm/headless";
import { askInFooter } from "../cli/questionFooter";
import type { IQuestion, IQuestionOutcome } from "../cli/question";

const COLS = 40;
const ROWS = 12;
const ENTER = "\r";
const DOWN = "\x1b[B";

class FakeKeyboard extends EventEmitter {
  isRaw = false;
  readonly modes: boolean[] = [];
  paused = true;
  setRawMode(mode: boolean): this {
    this.isRaw = mode;
    this.modes.push(mode);
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
}

class FakeScreen extends EventEmitter {
  readonly written: string[] = [];
  columns = COLS;
  rows = ROWS;
  write(chunk: string): boolean {
    this.written.push(chunk);
    return true;
  }
}

interface IRun {
  readonly keyboard: FakeKeyboard;
  readonly screen: FakeScreen;
  readonly done: Promise<IQuestionOutcome>;
}

/** Pose une question sous une ligne déjà écrite par la commande. */
function open(question: IQuestion): IRun {
  const keyboard = new FakeKeyboard();
  const screen = new FakeScreen();
  screen.write("sortie de la commande\r\n");
  const done = askInFooter(question, { input: keyboard, output: screen });
  return { keyboard, screen, done };
}

function press(run: IRun, ...chunks: string[]): void {
  for (const bytes of chunks)
    run.keyboard.emit("data", Buffer.from(bytes, "utf8"));
}

/** L'écran tel qu'un terminal l'afficherait, et la place de son curseur. */
async function read(
  run: IRun,
): Promise<{ lines: string[]; x: number; y: number }> {
  const term = new xterm.Terminal({
    cols: COLS,
    rows: ROWS,
    allowProposedApi: true,
  });
  await new Promise<void>((resolve) =>
    term.write(run.screen.written.join(""), resolve),
  );
  const buf = term.buffer.active;
  const lines: string[] = [];
  for (let i = 0; i < ROWS; i++) {
    lines.push(buf.getLine(buf.baseY + i)?.translateToString(true) ?? "");
  }
  const at = { x: buf.cursorX, y: buf.cursorY };
  term.dispose();
  // Les lignes vides du bas ne disent rien.
  while (lines.length > 0 && lines.at(-1) === "") lines.pop();
  return { lines, ...at };
}

const roles: IQuestion = {
  kind: "checkbox",
  key: "roles",
  message: "Rôles",
  choices: [
    { value: "ROLE_USER", label: "Utilisateur", checked: true },
    { value: "ROLE_ADMIN", label: "Administrateur" },
  ],
};

describe("pied de terminal", () => {
  it("dessine la question sous la sortie, puis ne laisse que le résumé", async () => {
    const run = open(roles);
    expect((await read(run)).lines).toEqual([
      "sortie de la commande",
      "? Rôles",
      "▸ ◉ Utilisateur",
      "  ◯ Administrateur",
      "  ↑↓ choisir · Espace cocher · Entrée …",
    ]);
    press(run, DOWN, " ", ENTER);
    expect(await run.done).toEqual({
      action: "accept",
      value: ["ROLE_USER", "ROLE_ADMIN"],
    });
    expect((await read(run)).lines).toEqual([
      "sortie de la commande",
      "✔ Rôles Utilisateur, Administrateur",
    ]);
  });

  it("rend le clavier dans son mode d'origine et décroche ses écouteurs", async () => {
    const run = open(roles);
    expect(run.keyboard.paused).toBe(false);
    press(run, ENTER);
    await run.done;
    expect(run.keyboard.modes).toEqual([true, false]);
    expect(run.keyboard.listenerCount("data")).toBe(0);
    expect(run.keyboard.listenerCount("end")).toBe(0);
    expect(run.screen.listenerCount("resize")).toBe(0);
    expect(run.keyboard.paused).toBe(true);
  });

  it("place le curseur du terminal au point de saisie", async () => {
    const run = open({ kind: "input", key: "name", message: "Nom" });
    press(run, "ab", "\x1b[D");
    const shown = await read(run);
    expect(shown.lines.at(-1)).toBe("? Nom ab");
    expect({ x: shown.x, y: shown.y }).toEqual({ x: 7, y: 1 });
    press(run, ENTER);
    expect(await run.done).toEqual({ action: "accept", value: "ab" });
  });

  it("redessine en place une liste qui grandit et rétrécit, sans débris", async () => {
    const run = open({ kind: "list", key: "index", message: "Index" });
    press(run, "siteId,createdAt", ENTER, "visitId", ENTER);
    expect((await read(run)).lines).toEqual([
      "sortie de la commande",
      "? Index",
      "  · siteId,createdAt",
      "  · visitId",
      "  › ",
      "  Entrée ajoute · Entrée sur une ligne…",
    ]);
    press(run, "\x1b[A", "\x7f".repeat(7), "\x7f", ENTER);
    expect(await run.done).toEqual({
      action: "accept",
      value: ["siteId,createdAt"],
    });
    expect((await read(run)).lines).toEqual([
      "sortie de la commande",
      "✔ Index siteId,createdAt",
    ]);
  });

  it("un secret n'est jamais écrit, ni pendant ni après", async () => {
    const run = open({
      kind: "secret",
      key: "password",
      message: "Mot de passe",
    });
    press(run, "s3cr3t", ENTER);
    expect(await run.done).toEqual({ action: "accept", value: "s3cr3t" });
    expect(run.screen.written.join("")).not.toContain("s3cr3t");
    expect((await read(run)).lines.at(-1)).toBe("✔ Mot de passe (saisi)");
  });

  it("un Échap SEUL annule après le délai de séquence", async () => {
    const run = open({ kind: "confirm", key: "go", message: "Continuer ?" });
    press(run, "\x1b");
    expect(await run.done).toEqual({ action: "cancel" });
    expect((await read(run)).lines.at(-1)).toBe("✗ Continuer ? (annulé)");
  });

  it("un clavier fermé annule au lieu de pendre", async () => {
    const run = open({ kind: "input", key: "name", message: "Nom" });
    run.keyboard.emit("end");
    expect(await run.done).toEqual({ action: "cancel" });
    expect(run.keyboard.modes).toEqual([true, false]);
  });

  it("aucune ligne ne déborde : le bloc garde son nombre de lignes à l'écran", async () => {
    const run = open({
      kind: "select",
      key: "type",
      message: "Une question au libellé bien plus long que la largeur",
      choices: [
        { value: "a", label: "Un choix au libellé lui aussi bien trop long" },
      ],
    });
    press(run, DOWN, DOWN);
    const shown = await read(run);
    // Sortie, question, un choix, aide : quatre lignes, aucune repliée.
    expect(shown.lines).toHaveLength(4);
    for (const line of shown.lines) expect(line.length).toBeLessThan(COLS);
    press(run, ENTER);
    await run.done;
  });
});
