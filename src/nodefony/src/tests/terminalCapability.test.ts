/**
 * Le verdict sur le terminal (`service/dev/terminalCapability.ts`) : sonde
 * interprétée, sérialisation pour `NF_DEV_TERMINAL`, relecture pure.
 */
import { describe, it, expect } from "vitest";
import { InputDecoder } from "../service/dev/inputDecoder";
import {
  DEV_TERMINAL_ENV,
  TERMINAL_PROBE,
  interpretProbe,
  readTerminalVerdict,
  serializeTerminalVerdict,
  type ITerminalVerdict,
} from "../service/dev/terminalCapability";

const verdict: ITerminalVerdict = {
  columns: 120,
  rows: 40,
  colorDepth: 24,
  charset: "unicode",
  input: false,
  fullscreen: true,
  synchronized: false,
};

describe("interpretProbe", () => {
  it("la sonde demande DECRQM 2026 puis la position du curseur, en dernier", () => {
    expect(TERMINAL_PROBE).to.equal("\x1b[?2026$p\x1b[6n");
  });

  it("position du curseur ⇒ plein écran, sonde finie ; DECRQM 2026 ⇒ synchronisé", () => {
    const events = new InputDecoder().feed("\x1b[?2026;2$y\x1b[12;1R");
    expect(interpretProbe(events)).to.deep.equal({
      fullscreen: true,
      synchronized: true,
      complete: true,
    });
  });

  it("terminal muet : rien d'accordé ; DECRQM « non reconnu » ne vaut pas oui", () => {
    expect(interpretProbe([])).to.deep.equal({
      fullscreen: false,
      synchronized: false,
      complete: false,
    });
    const events = new InputDecoder().feed("\x1b[?2026;0$y\x1b[1;1R");
    expect(interpretProbe(events).synchronized).to.equal(false);
    const other = new InputDecoder().feed("\x1b[?1049;1$y");
    expect(interpretProbe(other)).to.deep.include({
      synchronized: false,
      complete: false,
    });
  });

  it("une frappe pendant l'attente n'accorde rien", () => {
    const events = new InputDecoder().feed("abc\r");
    expect(interpretProbe(events).fullscreen).to.equal(false);
  });
});

describe("NF_DEV_TERMINAL", () => {
  it("aller-retour exact", () => {
    const env = { [DEV_TERMINAL_ENV]: serializeTerminalVerdict(verdict) };
    expect(DEV_TERMINAL_ENV).to.equal("NF_DEV_TERMINAL");
    expect(readTerminalVerdict(env)).to.deep.equal(verdict);
  });

  it("absent, illisible ou hors domaine ⇒ null en entier, jamais à moitié", () => {
    const read = (raw: string | undefined): ITerminalVerdict | null =>
      readTerminalVerdict({ [DEV_TERMINAL_ENV]: raw });
    expect(readTerminalVerdict({})).to.equal(null);
    expect(read("")).to.equal(null);
    expect(read("{")).to.equal(null);
    expect(read("null")).to.equal(null);
    expect(read("x".repeat(2000))).to.equal(null);
    for (const patch of [
      { columns: 0 },
      { rows: -1 },
      { columns: 1.5 },
      { columns: 100_000 },
      { colorDepth: 16 },
      { charset: "latin1" },
      { input: "false" },
      { fullscreen: 1 },
      { synchronized: undefined },
    ]) {
      expect(
        read(JSON.stringify({ ...verdict, ...patch })),
        JSON.stringify(patch),
      ).to.equal(null);
    }
  });
});
