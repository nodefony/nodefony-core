/**
 * La bande `/nodefony` de l'invite (`service/dev/devMenuBand.ts`, #538) : le
 * menu tiré du manifeste du CLI et de `startMenu.ts`, son filtre à la frappe,
 * et ce qu'Entrée, Tab et Échap y font.
 */
import { describe, expect, it, vi } from "vitest";
import type { ICliManifest } from "../cli/completion";
import {
  PromptMenuBand,
  buildPromptMenu,
  promptMenuStepsAside,
  promptMenuView,
  type IPromptMenu,
} from "../service/dev/devMenuBand";
import type { IRegion } from "../service/dev/devLayout";
import { visibleWidth } from "../runtime/textWidth";
import type { InputEvent } from "../service/dev/inputDecoder";

const command = (name: string, description: string, group?: string) => ({
  name,
  aliases: [],
  description,
  options: [],
  ...(group === undefined ? {} : { group }),
});

const manifest: ICliManifest = {
  version: "0.0.0",
  globalOptions: [],
  commands: [
    command("development", "démarre en développement", "LANCER"),
    command("status", "ce qui tourne ici", "LANCER"),
    command("menu", "le menu interactif", "COMPRENDRE"),
    // Rangée AVANT build (Comprendre), et son résumé répond aussi à « build ».
    command("doctor", "diagnostic, avant ou après le build", "COMPRENDRE"),
    command(
      "build",
      "compile modules puis application",
      "GÉNÉRER ET CONSTRUIRE",
    ),
    command("inspect", "l'état réel de l'application", "COMPRENDRE"),
    command("demo:ping", "une commande de module sans intention"),
  ],
};

const subjects = {
  routes: { summary: "les routes montées" },
  modules: { summary: "les modules chargés" },
  module: { summary: "un module", param: "name" },
};

const menu = (): IPromptMenu =>
  buildPromptMenu({ manifest, inspectSubjects: subjects });

const choices = (m: IPromptMenu, draft: string): string[] =>
  promptMenuView(m, draft).choices.map((c) => c.value);

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

function opened(draft: string) {
  const state = { draft };
  const hooks = {
    draft: () => state.draft,
    fill: vi.fn((text: string) => {
      state.draft = text;
    }),
    submit: vi.fn(),
    dismiss: vi.fn(),
  };
  const band = new PromptMenuBand(
    menu(),
    { color: false, charset: "unicode" },
    hooks,
  );
  return { band, hooks, state };
}

describe("buildPromptMenu — le menu de l'invite", () => {
  it("les verbes d'abord, sous « Invite », puis les commandes du CLI en ligne d'invite", () => {
    const values = choices(menu(), "/");
    expect(values.slice(0, 5)).to.deep.equal([
      "/status",
      "/restart",
      "/clear",
      "/help",
      "/quit",
    ]);
    expect(values).to.include("/nodefony build");
    expect(values).to.include("/nodefony inspect");
    expect(menu().items[0]).to.deep.equal({
      kind: "separator",
      label: "Invite",
    });
  });

  it("jamais une commande de runtime, ni le menu, ni ce qu'un verbe porte déjà", () => {
    const values = choices(menu(), "/");
    expect(values).to.not.include("/nodefony development");
    expect(values).to.not.include("/nodefony menu");
    expect(values).to.not.include("/nodefony status");
  });

  it("une commande sans intention garde sa place, sous « Commandes du projet »", () => {
    const items = menu().items;
    const at = items.findIndex(
      (i) => i.kind === "choice" && i.value === "/nodefony demo:ping",
    );
    expect(at).to.be.greaterThan(0);
    const group = items.slice(0, at).findLast((i) => i.kind === "separator");
    expect(group?.label).to.equal("Commandes du projet");
  });

  it("sans manifeste : les verbes seuls", () => {
    const bare = buildPromptMenu({ manifest: null, inspectSubjects: subjects });
    expect(choices(bare, "/")).to.have.length(5);
  });

  it("inspect : les sujets SANS paramètre, en ligne d'invite", () => {
    expect(
      menu().inspect.map((i) => i.kind === "choice" && i.value),
    ).to.deep.equal(["/nodefony inspect routes", "/nodefony inspect modules"]);
  });
});

describe("promptMenuView — le filtre à la frappe", () => {
  it("`/re` filtre tout le menu ; `/nodefony …` les seules commandes du CLI", () => {
    expect(choices(menu(), "/rest")).to.deep.equal(["/restart"]);
    const cli = choices(menu(), "/nodefony");
    expect(cli.length).to.be.greaterThan(0);
    expect(cli.every((v) => v.startsWith("/nodefony "))).to.equal(true);
    expect(choices(menu(), "/nodefony compile")).to.deep.equal([
      "/nodefony build",
    ]);
  });

  it("`/nodefony inspect …` : le sous-menu des sujets, filtré", () => {
    const view = promptMenuView(menu(), "/nodefony inspect rou");
    expect(view.inspect).to.equal(true);
    expect(view.choices.map((c) => c.value)).to.deep.equal([
      "/nodefony inspect routes",
    ]);
    // `/nodefony inspecter` n'est pas le mot `inspect`.
    expect(promptMenuView(menu(), "/nodefony inspecter").inspect).to.equal(
      false,
    );
  });

  it("passé le mot qu'elle choisit, la bande s'efface : Entrée ne PERD jamais d'option", () => {
    const m = menu();
    // Le défaut vu : « build --f » répondait par build, Entrée envoyait build seul.
    expect(choices(m, "/nodefony build --f")).to.deep.equal([]);
    for (const draft of [
      "/nodefony build ",
      "/nodefony inspect routes --json",
      "/nodefony inspect module studio",
      "/restart maintenant",
    ]) {
      expect(promptMenuStepsAside(m, draft), draft).to.equal(true);
    }
    for (const draft of [
      "/nodefony build",
      "/nodefony ",
      "/nodefony inspect ",
      "/nodefony demo ping",
      "/rest",
    ]) {
      expect(promptMenuStepsAside(m, draft), draft).to.equal(false);
    }
  });
});

describe("PromptMenuBand — la bande ouverte", () => {
  it("la commande tapée en entier est choisie d'office ; ↓ ↑ déplacent le choix", () => {
    const { band } = opened("/nodefony build");
    expect(band.view().choices[0]?.value).to.equal("/nodefony doctor");
    expect(band.selection()?.value).to.equal("/nodefony build");
    const first = opened("/");
    first.band.view();
    expect(first.band.selection()?.value).to.equal("/status");
    expect(first.band.handle(key("down"))).to.equal(true);
    expect(first.band.selection()?.value).to.equal("/restart");
    first.band.handle(key("up"));
    first.band.handle(key("up"));
    expect(first.band.selection()?.value).to.equal("/status");
  });

  it("Entrée lance l'entrée SEULE à prolonger la saisie ; Tab n'est jamais à la bande", () => {
    const enter = opened("/res");
    expect(enter.band.handle(key("enter"))).to.equal(true);
    expect(enter.state.draft).to.equal("/restart");
    expect(enter.hooks.submit).toHaveBeenCalledTimes(1);
    // Tab complète le mot tapé, comme un shell : l'invite s'en charge.
    const tab = opened("/nodefony compile");
    expect(tab.band.handle(key("tab"))).to.equal(false);
    expect(tab.band.handle(key("tab", true))).to.equal(false);
    expect(tab.state.draft).to.equal("/nodefony compile");
  });

  it("cycle : écrit l'entrée mise en avant, puis la suivante, en boucle ; la liste reste figée", () => {
    const { band, state } = opened("/nodefony ");
    const values = band.view().choices.map((c) => c.value);
    expect(band.cycle(1)).to.equal(true);
    expect(state.draft).to.equal(values[0]);
    expect(band.cycling(state.draft)).to.equal(true);
    // Figée : la saisie « /nodefony doctor » ne refiltre pas la liste.
    expect(band.view().choices.map((c) => c.value)).to.deep.equal(values);
    band.cycle(1);
    expect(state.draft).to.equal(values[1]);
    band.cycle(-1);
    band.cycle(-1);
    expect(state.draft).to.equal(values.at(-1));
    // Entrée lance l'entrée parcourue : elle est désignée.
    band.handle(key("enter"));
    expect(band.cycling(state.draft)).to.equal(true);
  });

  it("une frappe garde le choix et rend la liste au filtre", () => {
    const { band, state } = opened("/nodefony ");
    band.view();
    band.cycle(1);
    state.draft = `${state.draft}x`;
    expect(band.cycling(state.draft)).to.equal(false);
    band.view();
    expect(band.cycling(state.draft)).to.equal(false);
    expect(opened("/zzz").band.cycle(1)).to.equal(false);
  });

  it("Entrée ne remplace JAMAIS la saisie par une entrée qu'on n'a pas désignée", () => {
    // Le défaut vu : « /nodefon » choisissait une commande au hasard du filtre.
    const vague = opened("/nodefony ");
    vague.band.view();
    expect(vague.band.handle(key("enter"))).to.equal(false);
    expect(vague.hooks.submit).not.toHaveBeenCalled();
    // Filtre par la description, pas par le début : pas d'office non plus.
    const fuzzy = opened("/nodefony compile");
    fuzzy.band.view();
    expect(fuzzy.band.handle(key("enter"))).to.equal(false);
    // Désignée par ↓ : Entrée la lance.
    vague.band.handle(key("down"));
    const designated = vague.band.selection()?.value ?? "";
    expect(vague.band.handle(key("enter"))).to.equal(true);
    expect(vague.state.draft.trim()).to.equal(designated);
  });

  it("un début de /nodefony (« /nod ») montre les commandes du CLI, pas un filtre sur les descriptions", () => {
    expect(choices(menu(), "/nod")).to.deep.equal(choices(menu(), "/nodefony"));
    expect(choices(menu(), "/no").length).to.be.lessThan(
      choices(menu(), "/nodefony").length,
    );
  });

  it("Entrée sur `inspect` ouvre SON menu, sans rien envoyer", () => {
    const { band, hooks, state } = opened("/nodefony insp");
    band.handle(key("enter"));
    expect(state.draft).to.equal("/nodefony inspect ");
    expect(hooks.submit).not.toHaveBeenCalled();
    expect(band.view().inspect).to.equal(true);
  });

  it("rien ne répond : Entrée et Tab passent à l'invite ; Échap retire la bande", () => {
    const { band, hooks } = opened("/zzz");
    expect(band.handle(key("enter"))).to.equal(false);
    expect(band.handle(key("tab"))).to.equal(false);
    expect(band.handle(key("escape"))).to.equal(true);
    expect(hooks.dismiss).toHaveBeenCalledTimes(1);
    // La frappe n'est jamais à la bande.
    expect(band.handle({ kind: "text", text: "a" })).to.equal(false);
  });

  it("rendu : exactement la hauteur donnée, l'en-tête, le choix marqué, son conseil en pied", () => {
    const { band } = opened("/nodefony compile");
    const lines = band.render(region(6));
    expect(lines).to.have.length(6);
    expect(lines[0]).to.contain("/nodefony · ↑↓ choisir");
    // L’entrée tombe une tabulation plus loin que sa rubrique.
    expect(lines.some((l) => l.startsWith("    ▸ build"))).to.equal(true);
    const all = opened("/").band.render(region(8));
    expect(all[1]).to.equal("  Invite");
    expect(all.some((l) => /^      \/\S/.test(l))).to.equal(true);
    expect(lines.at(-1)).to.contain("Compile modules puis application");
    const none = opened("/zzz").band.render(region(4));
    expect(none.at(-1)).to.equal("  aucune commande ne répond à « /zzz »");
  });

  it("rendu étroit : aucune ligne ne dépasse la largeur", () => {
    const { band } = opened("/");
    for (const line of band.render(region(10, 24))) {
      expect(visibleWidth(line)).to.be.at.most(24);
    }
  });
});
