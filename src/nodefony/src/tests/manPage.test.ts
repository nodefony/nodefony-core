import assert from "node:assert";
import { assert as chai } from "chai";
import fs from "node:fs";
import path from "node:path";
import { escapeRoff, renderManPage } from "../cli/manPage";
import CliKernel from "../kernel/CliKernel";
import type { ICliManifest } from "../cli/completion";

/**
 * La page `man nodefony` — son rendu, et sa FRAÎCHEUR.
 *
 * Le second point est le seul qui protège vraiment : une page man est un
 * fichier statique installé avec le paquet, et rien dans un build ne signale
 * qu'elle ne décrit plus le CLI. Le gate de fin de fichier la compare à ce que
 * commander porte aujourd'hui.
 */

/** Racine du workspace `nodefony` (ce fichier vit dans `src/tests/`). */
const CORE = path.resolve(import.meta.dirname, "../..");

const manifestBidon = (): ICliManifest => ({
  version: "9.9.9",
  globalOptions: ["-d", "--debug"],
  commands: [
    {
      name: "zzz-derniere",
      aliases: [],
      description: "commande de fin d'alphabet",
      options: [],
      args: [],
    },
    {
      name: "aaa-premiere",
      aliases: ["alias-a"],
      description: "commande de début d'alphabet",
      options: ["--json"],
      args: [],
    },
  ],
});

describe("manPage — échappement roff", () => {
  it("les trois pièges silencieux sont traités", () => {
    // Un tiret NU devient un tiret typographique : `--json` deviendrait
    // illisible ET non copiable depuis le terminal.
    assert.strictEqual(escapeRoff("--json"), "\\-\\-json");
    // La contre-oblique introduit les séquences roff.
    assert.strictEqual(escapeRoff("a\\b"), "a\\\\b");
    // Une ligne qui COMMENCE par un point est lue comme une directive : la
    // description disparaîtrait purement et simplement du rendu.
    assert.strictEqual(escapeRoff(".env.local"), "\\&.env.local");
    // Idem pour l'apostrophe en tête (autre marqueur de directive roff).
    assert.ok(escapeRoff("'quoted'").startsWith("\\&"));
  });

  it("un saut de ligne dans une description ne casse pas le paragraphe", () => {
    assert.strictEqual(escapeRoff("deux\n  lignes"), "deux lignes");
  });
});

describe("manPage — rendu", () => {
  it("porte l'en-tête, les sections obligatoires et la version", () => {
    const page = renderManPage(manifestBidon(), "9.9.9");
    assert.ok(page.startsWith(".TH NODEFONY 1 "), page.slice(0, 60));
    assert.ok(page.includes('"nodefony 9.9.9"'));
    for (const section of [
      ".SH NAME",
      ".SH SYNOPSIS",
      ".SH DESCRIPTION",
      ".SH COMMANDS",
      ".SH ENVIRONMENT",
      ".SH FILES",
      ".SH EXAMPLES",
    ]) {
      assert.ok(page.includes(section), `section manquante : ${section}`);
    }
    assert.ok(page.endsWith("\n"));
  });

  it("les commandes sont TRIÉES, et leurs alias affichés", () => {
    const page = renderManPage(manifestBidon(), "9.9.9");
    // L'ordre de commander n'a aucun sens pour un lecteur : on trie.
    assert.ok(
      page.indexOf("aaa\\-premiere") < page.indexOf("zzz\\-derniere"),
      "les commandes ne sont pas triées",
    );
    assert.ok(page.includes("aaa\\-premiere, alias\\-a"));
  });

  it("🔴 la page ANNONCE qu'elle ne liste pas les commandes de module", () => {
    // Le point qui décide de l'honnêteté de cette page : elle est installée
    // avec le PAQUET, donc elle ne peut pas connaître les commandes qu'une
    // application ajoute par ses modules. Se taire là-dessus ferait croire que
    // le CLI se limite à ce qu'elle énumère — le même défaut que le menu avait.
    const page = renderManPage(manifestBidon(), "9.9.9");
    assert.match(page, /FRAMEWORK/u);
    assert.match(page, /modules/u);
    assert.match(page, /nodefony \\-\\-help/u);
  });

  it("🔴 aucune DATE : le rendu doit être déterministe", () => {
    // `.TH` accepte un champ date. Le remplir ferait échouer le gate de
    // fraîcheur le lendemain de la génération, pour une page inchangée — et un
    // gate qui crie sans raison finit désarmé.
    const a = renderManPage(manifestBidon(), "9.9.9");
    const b = renderManPage(manifestBidon(), "9.9.9");
    assert.strictEqual(a, b);
    assert.doesNotMatch(a, /\d{4}-\d{2}-\d{2}/u);
  });

  it("les lignes de DIRECTIVE ne sont jamais repliées", () => {
    // Une directive coupée en deux cesse d'être une directive : le rendu perd
    // silencieusement la mise en forme.
    const long = {
      ...manifestBidon(),
      commands: [
        {
          name: "commande-au-nom-vraiment-tres-long-pour-depasser-la-largeur-des-lignes-source",
          aliases: [],
          description: "x",
          options: [],
          args: [],
        },
      ],
    };
    const lignes = renderManPage(long, "9.9.9").split("\n");
    // Le terme doit apparaître sur UNE seule ligne de directive, entier —
    // le SYNOPSIS porte d'autres `.B` (`.B nodefony`), qui ne sont pas concernés.
    const terme = lignes.filter(
      (l) => l.startsWith(".B ") && l.includes("commande\\-au\\-nom"),
    );
    chai.lengthOf(
      terme,
      1,
      `le terme long devrait tenir sur une ligne : ${JSON.stringify(terme)}`,
    );
    assert.ok(
      terme[0]?.endsWith("largeur\\-des\\-lignes\\-source"),
      `le terme a été coupé : ${terme[0]}`,
    );
  });
});

describe("manPage — GATE de fraîcheur", () => {
  it("🔴 man/nodefony.1 décrit le CLI d'AUJOURD'HUI", () => {
    // Sans ce gate, la page se périme en silence : rien dans un build ne
    // compare un fichier roff au CLI. Réparation : `node scripts/generate-man.mjs`.
    const fichier = path.join(CORE, "man", "nodefony.1");
    assert.ok(
      fs.existsSync(fichier),
      "man/nodefony.1 absent — node scripts/generate-man.mjs",
    );
    const version = (
      JSON.parse(fs.readFileSync(path.join(CORE, "package.json"), "utf8")) as {
        version: string;
      }
    ).version;
    const cli = new CliKernel("development");
    const attendu = renderManPage(cli.buildBuiltinManifest(), version);
    assert.strictEqual(
      fs.readFileSync(fichier, "utf8"),
      attendu,
      "man/nodefony.1 est PÉRIMÉE — node scripts/generate-man.mjs",
    );
  });

  it("le paquet DÉCLARE la page, et l'embarque", () => {
    // Deux champs, deux rôles distincts : `man` fait poser la page par npm à
    // l'installation globale, `files` la fait entrer dans le tarball. L'un sans
    // l'autre donne une page qui n'existe pas là où on la cherche.
    const pkg = JSON.parse(
      fs.readFileSync(path.join(CORE, "package.json"), "utf8"),
    ) as { man?: string[]; files?: string[] };
    assert.deepStrictEqual(pkg.man, ["./man/nodefony.1"]);
    assert.ok(pkg.files?.includes("man"), "`man` absent de `files`");
  });
});
