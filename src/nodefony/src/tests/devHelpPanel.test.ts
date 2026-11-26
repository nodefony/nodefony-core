/**
 * L'aide de l'invite en panneau (`service/dev/devHelpPanel.ts`, #538 D9/D10) :
 * l'invite d'abord, puis le CLI rangé comme `nodefony --help`.
 */
import { describe, expect, it } from "vitest";
import type { ICliManifest } from "../cli/completion";
import { buildHelpPanel } from "../service/dev/devHelpPanel";

const manifest: ICliManifest = {
  version: "10.0.0",
  globalOptions: [],
  commands: [
    {
      name: "inspect",
      aliases: [],
      description: "lire l'état réel",
      options: [],
      args: [["routes", "services"]],
      group: "COMPRENDRE",
    },
    {
      name: "development",
      aliases: ["dev"],
      description: "démarrer en développement",
      options: [],
      group: "LANCER",
    },
    {
      name: "http:network",
      aliases: [],
      description: "relevé réseau",
      options: [],
    },
  ],
};

describe("buildHelpPanel — l'aide en rubriques", () => {
  it("rubrique Invite d'abord : les commandes préfixées et leurs autres noms, puis les gestes", () => {
    const panel = buildHelpPanel({
      gestures: [{ keys: "Alt+1…9", does: "changer d'onglet" }],
      manifest: null,
    });
    const [invite] = panel.pages;
    expect(invite?.title).to.equal("Invite");
    expect(invite?.rows).to.deep.include({
      kind: "entry",
      key: "/restart · /reboot",
      value: "relancer le serveur — force un rechargement différé",
    });
    expect(invite?.rows).to.deep.include({
      kind: "entry",
      key: "/quit · /exit",
      value: "arrêter proprement",
    });
    expect(invite?.rows).to.deep.include({
      kind: "entry",
      key: "/nodefony <commande>",
      value: "une commande du CLI — la bande les propose dès le « / »",
    });
    expect(invite?.rows.at(-1)).to.deep.equal({
      kind: "entry",
      key: "Alt+1…9",
      value: "changer d'onglet",
    });
  });

  it("le CLI rangé par intention, dans l'ordre de la journée", () => {
    const panel = buildHelpPanel({ gestures: [], manifest });
    expect(panel.pages.map((p) => p.title)).to.deep.equal([
      "Invite",
      "Lancer",
      "Comprendre",
      "Autres",
    ]);
    const comprendre = panel.pages[2];
    expect(comprendre?.rows).to.deep.equal([
      { kind: "entry", key: "inspect", value: "lire l'état réel" },
      { kind: "entry", key: "", value: "→ routes, services" },
    ]);
    expect(panel.pages[1]?.rows[0]).to.deep.equal({
      kind: "entry",
      key: "development · dev",
      value: "démarrer en développement",
    });
  });

  it("une commande de module sans groupe tombe sous « Autres » (le manifeste ne nomme pas son module)", () => {
    const panel = buildHelpPanel({ gestures: [], manifest });
    expect(panel.pages.at(-1)?.rows).to.deep.equal([
      { kind: "entry", key: "http:network", value: "relevé réseau" },
    ]);
  });

  it("manifeste absent : une rubrique qui DIT pourquoi la liste manque", () => {
    const panel = buildHelpPanel({ gestures: [], manifest: null });
    expect(panel.pages.at(-1)?.title).to.equal("CLI");
    expect(JSON.stringify(panel.pages.at(-1))).to.contain("cli-manifest.json");
  });
});
