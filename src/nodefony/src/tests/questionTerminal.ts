/**
 * Un faux terminal pour éprouver une question PAR OCTETS (#538 lot 2b-1) :
 * un clavier qui reçoit les octets qu'un vrai terminal enverrait, un écran qui
 * garde ce qu'on lui écrit — et sa lecture par un vrai émulateur.
 */
import { EventEmitter } from "node:events";
import xterm from "@xterm/headless";

/** Un clavier : mode brut suivi, octets versés à la main. */
export class FakeKeyboard extends EventEmitter {
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
  /** Frappes arrivées quand personne n'écoute : un terminal les garde. */
  readonly #pending: string[] = [];

  constructor() {
    super();
    this.on("newListener", (event: string) => {
      // L'écouteur n'est posé qu'APRÈS cet évènement : on rend la main d'abord.
      if (event === "data") setImmediate(() => this.#flush());
    });
  }

  /** Verse des octets, comme un terminal à chaque frappe. */
  press(...chunks: string[]): void {
    this.#pending.push(...chunks);
    this.#flush();
  }

  #flush(): void {
    // Une question réglée décroche son écouteur : la suite attend la suivante.
    while (this.#pending.length > 0 && this.listenerCount("data") > 0) {
      const bytes = this.#pending.shift() ?? "";
      this.emit("data", Buffer.from(bytes, "utf8"));
    }
  }
}

/** Un écran : garde ce qui lui est écrit. */
export class FakeScreen extends EventEmitter {
  readonly written: string[] = [];
  constructor(
    public columns = 40,
    public rows = 12,
  ) {
    super();
  }
  write(chunk: string): boolean {
    this.written.push(chunk);
    this.emit("written", chunk);
    return true;
  }
}

/** Les touches qui choisissent la n-ième ligne d'une liste (Début, ↓…, Entrée). */
export function pick(n: number): string {
  return `\x1b[H${"\x1b[B".repeat(n - 1)}\r`;
}

/**
 * Répond aux questions AU RYTHME où elles s'ouvrent, comme un humain : une
 * réponse par question, versée quand la question suivante se dessine — jamais
 * d'avance (le clavier d'une question réglée ne lit plus rien).
 *
 * @param keyboard - le clavier.
 * @param screen - l'écran, dont on guette les images.
 * @param replies - les octets de chaque réponse, dans l'ordre des questions.
 */
export function answerEachQuestion(
  keyboard: FakeKeyboard,
  screen: FakeScreen,
  replies: readonly string[],
): void {
  const queue = [...replies];
  let waiting = true;
  screen.on("written", (chunk: string) => {
    // Le résumé d'une question réglée : la suivante peut s'ouvrir.
    if (/[✔✗] /u.test(chunk)) {
      waiting = true;
      return;
    }
    // Une image (« effacer sous le curseur ») après un résumé : une question s'ouvre.
    if (waiting && chunk.includes("\x1b[J")) {
      const next = queue.shift();
      if (next === undefined) return;
      waiting = false;
      setImmediate(() => keyboard.press(next));
    }
  });
}

/**
 * L'écran tel qu'un terminal l'afficherait, lignes vides du bas retirées, et
 * la place de son curseur.
 *
 * @param screen - ce que l'hôte a écrit.
 * @returns les lignes et le curseur.
 */
export async function readScreen(
  screen: FakeScreen,
): Promise<{ lines: string[]; x: number; y: number }> {
  const term = new xterm.Terminal({
    cols: screen.columns,
    rows: screen.rows,
    allowProposedApi: true,
  });
  await new Promise<void>((resolve) =>
    term.write(screen.written.join(""), resolve),
  );
  const buf = term.buffer.active;
  const lines: string[] = [];
  for (let i = 0; i < screen.rows; i++) {
    lines.push(buf.getLine(buf.baseY + i)?.translateToString(true) ?? "");
  }
  const at = { x: buf.cursorX, y: buf.cursorY };
  term.dispose();
  while (lines.length > 0 && lines.at(-1) === "") lines.pop();
  return { lines, ...at };
}

/** Laisse passer les microtâches (une question s'ouvre après un `await`). */
export function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Attend qu'une question ÉCOUTE le clavier — un fait, pas un délai : l'hôte
 * se charge au premier dialogue, après un `import()`.
 *
 * @param keyboard - le clavier.
 */
export async function whenAsking(keyboard: FakeKeyboard): Promise<void> {
  while (keyboard.listenerCount("data") === 0) await tick();
}
