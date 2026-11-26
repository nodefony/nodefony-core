/**
 * Ctrl+R dans l'invite (`service/dev/devHistorySearch.ts`, #538, D11) : la
 * bande qui cherche dans l'historique par `PromptHistory.search`, et ce que
 * la frappe, ↑↓, Ctrl+R, Entrée et Échap y font.
 */
import { describe, expect, it, vi } from "vitest";
import { HistorySearchBand } from "../service/dev/devHistorySearch";
import type { IRegion } from "../service/dev/devLayout";
import type { InputEvent } from "../service/dev/inputDecoder";
import { PromptHistory } from "../service/dev/promptHistory";
import { visibleWidth } from "../runtime/textWidth";

const NOW = 1_000_000_000;

const key = (
  name: Extract<InputEvent, { kind: "key" }>["key"],
  ctrl = false,
): InputEvent => ({ kind: "key", key: name, ctrl, alt: false, shift: false });

const region = (height: number, width = 72): IRegion => ({
  kind: "band",
  row: 0,
  column: 0,
  width,
  height,
});

function opened(texts: readonly string[]) {
  const history = new PromptHistory();
  // La plus ancienne d'abord : la dernière saisie est la plus récente.
  texts.forEach((text, i) => history.remember(text, "server", NOW + i));
  const hooks = {
    search: vi.fn((term: string) => history.search(term, NOW + texts.length)),
    revision: () => history.length,
    pick: vi.fn(),
    close: vi.fn(),
  };
  const band = new HistorySearchBand(
    { color: false, charset: "unicode" },
    hooks,
  );
  return { band, hooks, history };
}

describe("HistorySearchBand — Ctrl+R", () => {
  it("la frappe écrit le terme et filtre ; la plus récente d'abord", () => {
    const { band } = opened(["/clear", "/nodefony build", "/restart"]);
    expect(band.found().map((e) => e.text)).to.deep.equal([
      "/restart",
      "/nodefony build",
      "/clear",
    ]);
    band.handle({ kind: "text", text: "bu" });
    expect(band.term).to.equal("bu");
    expect(band.found().map((e) => e.text)).to.deep.equal(["/nodefony build"]);
    band.handle(key("backspace"));
    band.handle(key("backspace"));
    expect(band.found()).to.have.length(3);
    // Retour arrière ôte un graphème entier, jamais une moitié d’émoji.
    band.handle({ kind: "text", text: "é👍🏽" });
    band.handle(key("backspace"));
    expect(band.term).to.equal("é");
  });

  it("Ctrl+R et ↓ passent à l'entrée suivante ; Entrée la REPREND sans l'envoyer", () => {
    const { band, hooks } = opened(["/clear", "/restart"]);
    expect(band.handle(key("r", true))).to.equal(true);
    expect(band.selection()?.text).to.equal("/clear");
    band.handle(key("up"));
    expect(band.selection()?.text).to.equal("/restart");
    band.handle(key("down"));
    band.handle(key("enter"));
    expect(hooks.close).toHaveBeenCalledTimes(1);
    expect(hooks.pick).toHaveBeenCalledWith("/clear");
  });

  it("Échap, Ctrl+C, Ctrl+G referment sans rien reprendre", () => {
    for (const event of [key("escape"), key("c", true), key("g", true)]) {
      const { band, hooks } = opened(["/clear"]);
      expect(band.handle(event)).to.equal(true);
      expect(hooks.close).toHaveBeenCalledTimes(1);
      expect(hooks.pick).not.toHaveBeenCalled();
    }
  });

  it("rien ne répond : Entrée referme sans reprendre, et le pied le dit", () => {
    const { band, hooks } = opened(["/clear"]);
    band.handle({ kind: "text", text: "zzz" });
    const lines = band.render(region(band.height(72)));
    expect(lines.at(-1)).to.equal("  aucune saisie ne répond à « zzz »");
    band.handle(key("enter"));
    expect(hooks.close).toHaveBeenCalledTimes(1);
    expect(hooks.pick).not.toHaveBeenCalled();
  });

  it("l'historique chargé APRÈS l'ouverture : la recherche se refait", () => {
    const { band, history } = opened([]);
    expect(band.found()).to.have.length(0);
    history.remember("/status", "server", NOW);
    expect(band.found().map((e) => e.text)).to.deep.equal(["/status"]);
  });

  it("la recherche ne se refait PAS à chaque image", () => {
    const { band, hooks } = opened(["/clear", "/restart"]);
    band.render(region(4));
    band.render(region(4));
    band.height(72);
    expect(hooks.search).toHaveBeenCalledTimes(1);
  });

  it("rendu : la hauteur donnée, l'en-tête, le choix marqué ; jamais plus large", () => {
    const { band } = opened(["/clear", "ligne un\nligne deux"]);
    const lines = band.render(region(4));
    expect(lines).to.have.length(4);
    expect(lines[0]).to.contain("Ctrl+R historique");
    expect(lines[1]).to.equal("▸ ligne un ⏎ ligne deux · server");
    for (const line of band.render(region(6, 20))) {
      expect(visibleWidth(line)).to.be.at.most(20);
    }
  });

  it("PgUp/PgDn passent au défilement ; toute autre touche reste à la bande", () => {
    const { band } = opened(["/clear"]);
    expect(band.handle(key("pageup"))).to.equal(false);
    expect(band.handle(key("home"))).to.equal(true);
    expect(band.handle(key("a", true))).to.equal(true);
  });
});
