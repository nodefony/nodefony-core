/**
 * L'aide de `nodefony` — groupée par INTENTION, et rendue par une fonction pure.
 *
 * Ce que ces cas protègent, et qui n'était éprouvé par rien : l'aide était
 * rendue par commander, avec sa largeur, ses styles et sa colonne creuse dès
 * qu'un nom était long. Le seul test existant vérifiait que quelques noms
 * apparaissaient quelque part — il serait passé sur une page illisible.
 */
import { describe, it } from "vitest";
import { assert } from "chai";
import {
  grouperCommandes,
  HELP_GROUPS,
  renderHelp,
  type IHelpCommand,
  type IHelpModel,
} from "../cli/helpReport";

/** Une commande réduite à ce que l'aide en dit. */
const cmd = (
  name: string,
  patch: Partial<IHelpCommand> = {},
): IHelpCommand => ({
  name,
  aliases: [],
  description: `ce que fait ${name}`,
  ...patch,
});

const modele = (patch: Partial<IHelpModel> = {}): IHelpModel => ({
  version: "10.0.0",
  commands: [
    cmd("development", { aliases: ["dev"], group: "LANCER" }),
    cmd("production", { aliases: ["prod", "start"], group: "LANCER" }),
    cmd("doctor", { aliases: ["check"], group: "COMPRENDRE" }),
    cmd("card", { group: "COMPRENDRE" }),
    cmd("inspect", {
      group: "COMPRENDRE",
      accepts: { label: "sujet", values: ["routes", "services", "config"] },
    }),
    cmd("orm:migrate", { module: "drizzle" }),
    cmd("test-frontend-angular:build-and-serve", { module: "frontend" }),
    cmd("orphan"),
  ],
  globalOptions: [
    { flags: "-d, --debug", description: "Mode debug" },
    { flags: "-h, --help", description: "Affiche cette aide" },
  ],
  modules: ["http", "framework", "drizzle"],
  jsonCommands: ["doctor --json", "inspect <sujet> --json"],
  ...patch,
});

/** Le rendu, à la largeur demandée, sans couleur. */
const rendu = (largeur: number, patch: Partial<IHelpModel> = {}): string[] =>
  renderHelp(modele(patch), { largeur, couleur: false });

describe("grouperCommandes — par intention, jamais par origine du code", () => {
  it("range chaque commande sous le groupe qu'elle DÉCLARE", () => {
    const groupes = grouperCommandes(modele().commands);
    const lancer = groupes.find((g) => g.titre === "LANCER");
    assert.deepStrictEqual(
      lancer?.commandes.map((c) => c.name),
      ["development", "production"],
    );
  });

  it("l'ordre des groupes est celui de la JOURNÉE, pas de la rencontre", () => {
    // 🔴 commander ordonne ses groupes par première rencontre, donc par ordre
    // d'ENREGISTREMENT des commandes : ajouter une commande quelque part
    // réordonnait l'aide entière.
    const titres = grouperCommandes([
      cmd("orm:x", { group: "BASE DE DONNÉES" }),
      cmd("dev", { group: "LANCER" }),
    ]).map((g) => g.titre);
    assert.deepStrictEqual(titres, ["LANCER", "BASE DE DONNÉES"]);
  });

  it("dans COMPRENDRE, l'ordre est celui de la DÉCOUVERTE", () => {
    const groupes = grouperCommandes(modele().commands);
    assert.deepStrictEqual(
      groupes
        .find((g) => g.titre === "COMPRENDRE")
        ?.commandes.map((c) => c.name),
      ["card", "doctor", "inspect"],
      "la carte de visite dit où l'on est ; elle passe avant le reste",
    );
  });

  it("sans groupe connu, la commande tombe sous SON module", () => {
    const groupes = grouperCommandes(modele().commands);
    const titres = groupes.map((g) => g.titre);
    assert.include(titres, "MODULE DRIZZLE");
    assert.include(titres, "MODULE FRONTEND");
  });

  it("un groupe INCONNU n'est pas une erreur — il ne classe simplement pas", () => {
    // Un module tiers peut écrire ce qu'il veut : l'aide ne doit pas inventer
    // une section pour lui, ni perdre la commande.
    const groupes = grouperCommandes([
      cmd("truc:machin", { group: "MON GROUPE À MOI", module: "truc" }),
    ]);
    assert.deepStrictEqual(
      groupes.map((g) => g.titre),
      ["MODULE TRUC"],
    );
  });

  it("sans groupe NI module, la commande ferme la marche", () => {
    const groupes = grouperCommandes(modele().commands);
    assert.equal(groupes.at(-1)?.titre, "AUTRES");
    assert.deepStrictEqual(
      groupes.at(-1)?.commandes.map((c) => c.name),
      ["orphan"],
    );
  });

  it("aucune commande n'est perdue en chemin", () => {
    const commands = modele().commands;
    const rendues = grouperCommandes(commands).flatMap((g) => g.commandes);
    assert.equal(rendues.length, commands.length);
  });
});

describe("renderHelp — un document PUR, qui tient dans le terminal", () => {
  it("🔴 aucune ligne ne déborde, de 48 à 96 colonnes", () => {
    for (const largeur of [48, 58, 80, 96]) {
      for (const l of rendu(largeur)) {
        assert.isAtMost(
          l.length,
          largeur,
          `ligne trop longue à ${largeur} colonnes : « ${l} »`,
        );
      }
    }
  });

  it("une commande NOMMÉE longuement ne creuse pas la colonne des autres", () => {
    // C'est tout l'écart avec commander : une seule commande longue élargissait
    // la colonne pour les trente-huit autres, et l'aide devenait un mur blanc.
    const lignes = rendu(96);
    const ligneDev = lignes.find((l) => l.includes("development|dev"));
    assert.isDefined(ligneDev);
    assert.isBelow(
      (ligneDev ?? "").indexOf("ce que fait"),
      34,
      "la description reste près du nom malgré une commande de 37 caractères",
    );
  });

  it("les alias sont RENDUS — un alias qu'on ne voit pas n'existe pas", () => {
    const texte = rendu(96).join("\n");
    assert.include(texte, "development|dev");
    assert.include(texte, "production|prod|start");
    assert.include(texte, "doctor|check");
  });

  it("ce qu'une commande ACCEPTE se lit sous elle, là où on la rencontre", () => {
    const lignes = rendu(80);
    const at = lignes.findIndex((l) => l.includes("inspect"));
    assert.isAtLeast(at, 0);
    const bloc = lignes.slice(at, at + 4).join("\n");
    assert.include(
      bloc,
      "sujet :",
      "et non dans une section réservée aux agents, en fin de page",
    );
    assert.include(bloc, "routes");
  });

  it("🔴 les valeurs s'ALIGNENT sous la description, sans puce à mi-hauteur", () => {
    // Rejetées à gauche derrière une flèche, elles cassaient la colonne que
    // l'œil venait d'établir — signalé sur le rendu réel.
    const lignes = rendu(80);
    const at = lignes.findIndex((l) => l.includes("inspect"));
    const ligneValeurs = lignes.slice(at).find((l) => l.includes("sujet :"));
    assert.isDefined(ligneValeurs);
    assert.notInclude(ligneValeurs ?? "", "↳", "pas de puce exotique");
    const colonneDescription = (lignes[at] ?? "").indexOf("ce que fait");
    assert.equal(
      (ligneValeurs ?? "").search(/\S/u),
      colonneDescription,
      "les valeurs commencent exactement sous la description",
    );
  });

  it("🔴 une énumération se replie ENTRE deux éléments, jamais au milieu", () => {
    // `\\s` avale l'espace insécable du point médian : replier aux espaces
    // mettait le séparateur en tête de ligne.
    const lignes = rendu(48, {
      commands: [
        cmd("inspect", {
          group: "COMPRENDRE",
          accepts: {
            label: "sujet",
            values: ["routes", "services", "config", "modules", "entities"],
          },
        }),
      ],
    });
    for (const l of lignes) {
      assert.notMatch(l, /^\s*·/u, `séparateur en tête de ligne : « ${l} »`);
    }
  });

  it("les groupes VIDES ne laissent pas de titre orphelin", () => {
    const texte = rendu(80, { commands: [cmd("dev", { group: "LANCER" })] });
    for (const groupe of HELP_GROUPS) {
      if (groupe === "LANCER") continue;
      assert.notInclude(texte.join("\n"), groupe);
    }
  });

  it("la note de situation et son geste sont rendus quand ils existent", () => {
    const texte = rendu(80, {
      note: "hors d'une application Nodefony",
      noteAction: "nodefony create app <nom>",
    }).join("\n");
    assert.include(texte, "hors d'une application");
    assert.include(texte, "create app");
  });
});

describe("renderHelp — la couleur ne change QUE la couleur", () => {
  /** Retire les séquences ANSI, quelles qu'elles soient. */
  const nu = (t: string): string =>
    // eslint-disable-next-line no-control-regex
    t.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "gu"), "");

  it("🔴 sans couleur, PAS une seule séquence d'échappement", () => {
    const texte = rendu(80).join("\n");
    assert.notInclude(
      texte,
      String.fromCharCode(27),
      "un `NO_COLOR` respecté à moitié pollue tout ce qui redirige la sortie",
    );
  });

  it("avec couleur, le texte DÉPOUILLÉ est identique", () => {
    const sans = renderHelp(modele(), { largeur: 80, couleur: false });
    const avec = renderHelp(modele(), { largeur: 80, couleur: true });
    assert.deepStrictEqual(avec.map(nu), sans);
  });
});
