import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import CliKernel from "../kernel/CliKernel";
import { descriptionWidth, type IHelpCommand } from "../cli/helpReport";

/**
 * 🔴 Une description de commande est un TITRE D'INDEX, et rien ne le disait.
 *
 * Ces chaînes ont trois lecteurs — l'aide, le menu interactif et la page de
 * manuel — et chacun les met en colonne. Une seule qui déborde replie la page
 * entière : l'œil ne lit plus un index, il lit un pavé. Vingt-quatre des
 * trente-neuf descriptions tenaient sur deux lignes à 80 colonnes, et neuf
 * étaient en anglais télégraphique dans une interface française.
 *
 * Rien ne l'empêchait, parce que rien ne les MESURAIT : une description est une
 * chaîne passée à un constructeur, et une chaîne trop longue compile. Ce gate
 * la mesure — contre la place RÉELLEMENT offerte, dérivée de la mise en page,
 * jamais contre un nombre écrit ici (cf {@link descriptionWidth}).
 *
 * Il couvre DEUX populations, parce que l'utilisateur, lui, les lit dans la même
 * colonne : les commandes du FRAMEWORK, mesurées sur le manifeste (seule façon
 * d'obtenir la valeur d'une description composée à l'exécution), et celles
 * qu'apportent les MODULES, lues dans leur source — elles vivent hors de ce
 * workspace, et rien ici ne peut les instancier. La place se calcule sur leur
 * UNION : la colonne des noms est unique pour toute la page, donc un nom long
 * apporté par un module rétrécit la place de toutes les autres.
 */

/** La largeur de référence : le terminal étroit qu'on rencontre partout. */
const LARGEUR = 80;

/**
 * Les commandes intégrées, telles que l'aide les recevra.
 *
 * On passe par le manifeste et non par les fichiers source : c'est la seule
 * façon de mesurer la VALEUR d'une description composée à l'exécution
 * (`completion` interpole la liste des shells). Lire le littéral du source
 * mesurerait le gabarit, pas ce que l'utilisateur lit.
 */
function commandesIntegrees(): IHelpCommand[] {
  const manifest = new CliKernel("development").buildBuiltinManifest();
  return manifest.commands.map((c) => ({
    name: c.name,
    aliases: c.aliases ?? [],
    description: c.description,
    group: c.group,
  }));
}

/** Racine du dépôt — `src/nodefony/src/tests` → quatre crans plus haut. */
const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

/**
 * Les fichiers de commande des modules du dépôt.
 *
 * Parcours en `fs`, jamais un `find` : la commande n'existe pas sous Windows, et
 * ce banc doit tourner sur les trois plateformes. Le filtre se compose avec
 * `path.sep` plutôt que de littéraliser `/`, pour la même raison.
 */
function fichiersDeCommande(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const complet = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "dist") continue;
      fichiersDeCommande(complet, acc);
    } else if (
      e.name.endsWith(".ts") &&
      !e.name.endsWith(".test.ts") &&
      complet.includes(path.join("nodefony", "command") + path.sep)
    ) {
      acc.push(complet);
    }
  }
  return acc;
}

/**
 * Le nom et la description d'une commande, lus dans sa source.
 *
 * Accepte les deux écritures du dépôt — guillemets et accents graves — parce
 * qu'une description qui porte une apostrophe française est écrite en accents
 * graves, et qu'un motif qui l'ignore rendrait `security:token` invisible sans
 * le dire. Une description INTERPOLÉE n'est pas mesurable statiquement : elle
 * rend `null`, et l'appelant en fait un échec plutôt qu'un silence.
 */
const SUPER =
  /super\(\s*(?:"((?:[^"\\]|\\.)*)"|`([^`$]*)`)\s*,\s*(?:"((?:[^"\\]|\\.)*)"|`([^`$]*)`)/s;

/** Le fichier définit-il une classe qui hérite de quelque chose ? */
const CLASSE =
  /(?:^|\n)\s*(?:export\s+)?(abstract\s+)?class\s+\w+\s+extends\s+\w+/;

/**
 * @returns la commande, `"delegue"` pour une base qui transmet la description
 *   de ses filles, ou `null` si le fichier ne définit aucune commande.
 *
 * 🔴 Ne JAMAIS filtrer sur `extends Command` : sept commandes du module ORM
 * héritent d'une base intermédiaire (`OrmMigrateCommand`), et un filtre écrit
 * ainsi les écartait TOUTES — le banc passait au vert sur une population
 * amputée de moitié, `orm:generate` (qui débordait) compris. La forme d'une
 * commande, c'est un `super(nom, description, …)`, pas le nom de son parent.
 */
function litCommande(fichier: string): IHelpCommand | "delegue" | null {
  const code = fs.readFileSync(fichier, "utf8");
  const classe = code.match(CLASSE);
  if (classe === null) return null;
  const m = code.match(SUPER);
  if (m === null) {
    // `super(...args)` : la base reçoit la description de ses filles, elle n'en
    // a pas à mesurer. Une classe abstraite est le cas normal de cette forme.
    return /super\(\s*\.\.\./.test(code) || classe[1] !== undefined
      ? "delegue"
      : null;
  }
  const name = m[1] ?? m[2];
  const description = m[3] ?? m[4];
  if (name === undefined || description === undefined) return null;
  return { name, aliases: [], description, group: "MODULES" };
}

describe("descriptions des commandes — un index, pas un pavé", () => {
  const commandes = commandesIntegrees();
  const place = descriptionWidth(commandes, LARGEUR);

  it("aucune ne déborde de la place que la mise en page lui laisse", () => {
    const trop = commandes
      .filter((c) => c.description.length > place)
      .map((c) => `${c.name} (${c.description.length} > ${place})`)
      .sort();
    expect(
      trop,
      `à ${LARGEUR} colonnes, ces descriptions passent sur deux lignes : ${trop.join(", ")}`,
    ).toEqual([]);
  });

  it("chacune commence par une minuscule — c'est une glose, pas une phrase", () => {
    // Une majuscule initiale fait lire chaque ligne comme le début d'une
    // phrase, et la colonne cesse d'être une liste. Les noms propres restent
    // possibles ailleurs dans la ligne ; seule l'initiale est contrainte.
    const capitales = commandes
      .filter((c) => {
        const premiere = c.description.charAt(0);
        return premiere !== "" && premiere === premiere.toLocaleUpperCase("fr");
      })
      .map((c) => `${c.name} : « ${c.description} »`)
      .sort();
    expect(
      capitales,
      `descriptions capitalisées : ${capitales.join(" · ")}`,
    ).toEqual([]);
  });

  it("aucune n'est vide", () => {
    const vides = commandes.filter((c) => c.description.trim() === "");
    expect(vides.map((c) => c.name)).toEqual([]);
  });
});

/**
 * Les commandes des MODULES — celles que le cœur ne peut pas instancier.
 *
 * Elles sont pourtant rendues dans la même colonne que les intégrées : une
 * description trop longue y replie la page exactement pareil. Le banc lit donc
 * leur source, et refuse de conclure sur une population qu'il aurait silencieusement
 * amputée — un fichier de commande dont la description ne se lit pas est un ÉCHEC,
 * jamais une ligne sautée.
 */
describe("descriptions des commandes de MODULES — même colonne, même règle", () => {
  const racines = [
    path.join(REPO, "src", "packages"),
    path.join(REPO, "src", "modules"),
  ];
  const fichiers = racines.flatMap((r) => fichiersDeCommande(r));
  const lus = fichiers.map((f) => ({ fichier: f, commande: litCommande(f) }));
  const commandes = lus
    .map((l) => l.commande)
    .filter((c): c is IHelpCommand => c !== null && c !== "delegue");

  // La place se calcule sur l'UNION : une seule colonne de noms pour toute la
  // page, donc un nom long apporté par un module rétrécit la place des autres.
  const place = descriptionWidth(
    [...commandesIntegrees(), ...commandes],
    LARGEUR,
  );

  it("le dépôt expose bien des commandes de modules à mesurer", () => {
    expect(
      commandes.length,
      "population de commandes de modules trop maigre — le parcours ou le motif " +
        "est cassé, et le banc conclurait sur une population AMPUTÉE (vécu : un " +
        "filtre sur `extends Command` en écartait sept d'un coup)",
    ).toBeGreaterThan(18);
  });

  it("chaque fichier de commande concret livre une description mesurable", () => {
    const muets = lus
      .filter((l) => l.commande === null)
      .filter((l) => CLASSE.test(fs.readFileSync(l.fichier, "utf8")))
      .map((l) => path.relative(REPO, l.fichier));
    expect(
      muets,
      `description illisible (interpolée, ou forme inattendue) : ${muets.join(", ")}`,
    ).toEqual([]);
  });

  it("aucune ne déborde de la place que la mise en page lui laisse", () => {
    const trop = commandes
      .filter((c) => c.description.length > place)
      .map((c) => `${c.name} (${c.description.length} > ${place})`)
      .sort();
    expect(
      trop,
      `à ${LARGEUR} colonnes, ces descriptions de modules passent sur deux lignes : ${trop.join(", ")}`,
    ).toEqual([]);
  });

  it("chacune commence par une minuscule — c'est une glose, pas une phrase", () => {
    const capitales = commandes
      .filter((c) => {
        const premiere = c.description.charAt(0);
        return premiere !== "" && premiere === premiere.toLocaleUpperCase("fr");
      })
      .map((c) => `${c.name} : « ${c.description} »`)
      .sort();
    expect(
      capitales,
      `descriptions capitalisées : ${capitales.join(" · ")}`,
    ).toEqual([]);
  });
});
