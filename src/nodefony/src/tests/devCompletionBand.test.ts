/**
 * Les propositions de Tab (`service/dev/devCompletionBand.ts`, #538, D12) :
 * la bande qui MONTRE les saisies possibles quand leur début commun
 * n'avance pas, et ce que la frappe, ↑↓, Tab, Entrée et Échap y font.
 */
import { describe, expect, it, vi } from "vitest";
import { CompletionBand } from "../service/dev/devCompletionBand";
import type { IRegion } from "../service/dev/devLayout";
import type { InputEvent } from "../service/dev/inputDecoder";
import { visibleWidth } from "../runtime/textWidth";

const key = (
  name: Extract<InputEvent, { kind: "key" }>["key"],
  shift = false,
): InputEvent => ({ kind: "key", key: name, ctrl: false, alt: false, shift });

const region = (height: number, width = 72): IRegion => ({
  kind: "band",
  row: 0,
  column: 0,
  width,
  height,
});

const CANDIDATES = [
  "/nodefony build --force",
  "/nodefony build --filter",
  "/nodefony build --debug",
];

function opened(draft = "/nodefony build ") {
  const state = { draft };
  const hooks = {
    draft: () => state.draft,
    fill: vi.fn((text: string) => {
      state.draft = text;
    }),
    close: vi.fn(),
  };
  const band = new CompletionBand(
    CANDIDATES,
    { color: false, charset: "unicode" },
    hooks,
  );
  return { band, hooks, state };
}

describe("CompletionBand — les propositions de Tab", () => {
  it("montre celles que la saisie prolonge encore ; le choix suit", () => {
    const { band, state } = opened();
    expect(band.shown()).to.have.length(3);
    band.handle(key("down"));
    expect(band.selection()).to.equal("/nodefony build --filter");
    state.draft = "/nodefony build --f";
    expect(band.shown()).to.deep.equal(CANDIDATES.slice(0, 2));
    expect(band.selection()).to.equal("/nodefony build --filter");
    state.draft = "/nodefony build --x";
    expect(band.shown()).to.have.length(0);
    expect(band.selection()).to.equal(null);
  });

  it("Tab et Entrée écrivent le choix suivi d'un blanc, sans rien envoyer", () => {
    for (const taken of [key("tab"), key("enter")]) {
      const { band, hooks } = opened();
      band.shown();
      expect(band.handle(taken)).to.equal(true);
      expect(hooks.close).toHaveBeenCalledTimes(1);
      expect(hooks.fill).toHaveBeenCalledWith("/nodefony build --force ");
    }
  });

  it("Maj+Tab et ↑ remontent ; Échap referme sans écrire ; la frappe passe à l'invite", () => {
    const { band, hooks } = opened();
    band.shown();
    band.handle(key("down"));
    band.handle(key("down"));
    band.handle(key("tab", true));
    expect(band.selection()).to.equal("/nodefony build --filter");
    band.handle(key("up"));
    expect(band.selection()).to.equal("/nodefony build --force");
    expect(band.handle({ kind: "text", text: "f" })).to.equal(false);
    expect(band.handle(key("escape"))).to.equal(true);
    expect(hooks.close).toHaveBeenCalledTimes(1);
    expect(hooks.fill).not.toHaveBeenCalled();
  });

  it("plus rien ne répond : Tab et Entrée passent à l'invite", () => {
    const { band } = opened("/nodefony build --x");
    expect(band.handle(key("tab"))).to.equal(false);
    expect(band.handle(key("enter"))).to.equal(false);
  });

  it("rendu : la hauteur donnée, le mot proposé seul, le choix marqué ; jamais plus large", () => {
    const { band } = opened();
    const lines = band.render(region(band.height(72)));
    expect(lines).to.have.length(4);
    expect(lines[0]).to.contain("Tab · 3 propositions");
    expect(lines[1]).to.equal("▸ --force");
    expect(lines[2]).to.equal("  --filter");
    for (const line of band.render(region(3, 16))) {
      expect(visibleWidth(line)).to.be.at.most(16);
    }
  });
});
