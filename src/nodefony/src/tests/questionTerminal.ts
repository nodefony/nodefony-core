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
  /** Verse des octets, comme un terminal à chaque frappe. */
  press(...chunks: string[]): void {
    for (const bytes of chunks) this.emit("data", Buffer.from(bytes, "utf8"));
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
    return true;
  }
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
