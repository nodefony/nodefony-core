/**
 * La sonde du terminal (`service/dev/terminalCapability.ts`), interprétée.
 * Le codec de `NF_DEV_TERMINAL` est éprouvé par `terminalVerdict.test.ts`.
 */
import { describe, it, expect } from "vitest";
import { InputDecoder } from "../service/dev/inputDecoder";
import {
  TERMINAL_PROBE,
  interpretProbe,
} from "../service/dev/terminalCapability";

describe("interpretProbe", () => {
  it("la sonde demande DECRQM 2026, la couleur de fond, puis la position du curseur, en dernier", () => {
    expect(TERMINAL_PROBE).to.equal("\x1b[?2026$p\x1b]11;?\x07\x1b[6n");
  });

  it("la couleur de fond (OSC 11) est relevée ; une autre réponse OSC n'en est pas une", () => {
    const events = new InputDecoder().feed(
      "\x1b]10;rgb:ffff/ffff/ffff\x07\x1b]11;rgb:1e1e/1e1e/1e1e\x1b\\\x1b[3;1R",
    );
    expect(interpretProbe(events)).to.deep.include({
      background: [30, 30, 30],
      complete: true,
    });
    const silent = new InputDecoder().feed("\x1b]10;rgb:ffff/ffff/ffff\x07");
    expect(interpretProbe(silent).background).to.equal(null);
  });

  it("position du curseur ⇒ plein écran, sonde finie ; DECRQM 2026 ⇒ synchronisé", () => {
    const events = new InputDecoder().feed("\x1b[?2026;2$y\x1b[12;1R");
    expect(interpretProbe(events)).to.deep.equal({
      fullscreen: true,
      synchronized: true,
      complete: true,
      background: null,
    });
  });

  it("terminal muet : rien d'accordé ; DECRQM « non reconnu » ne vaut pas oui", () => {
    expect(interpretProbe([])).to.deep.equal({
      fullscreen: false,
      synchronized: false,
      complete: false,
      background: null,
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
