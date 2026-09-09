import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

/**
 * Ce que cette suite garde : un ordre de travail donné à quelqu'un qui ne
 * connaît PAS le dépôt.
 *
 * Depuis que la configuration d'un module vit dans `nodefony/config/<module>.ts`,
 * une prescription qui envoie la modifier dans `nodefony.config.ts` ne se
 * trompe pas de mot — elle envoie ouvrir un fichier où la clé n'est PAS. Le
 * lecteur ne la trouve pas, et invente. Cinq passages étaient dans ce cas :
 * trois dans le guide d'agent livré avec chaque application, deux dans un skill
 * livré dans le paquet — et le guide se contredisait lui-même, sa règle générale
 * disant le bon endroit quatre-vingts lignes plus haut.
 *
 * Le contrôle ne peut pas être « le mot est interdit » : `publicOrigin`,
 * `trustedHosts` et les autres réglages courts vivent LÉGITIMEMENT dans le
 * manifeste racine, et un skill a de bonnes raisons de le nommer (le fichier
 * marque la racine d'un projet). Ce qui est fautif, c'est la COOCCURRENCE : le
 * manifeste nommé à portée d'une clé qui, elle, a déménagé dans un fragment.
 *
 * Les clés ne sont pas listées ici — elles se LISENT dans les fragments que le
 * scaffold rend. Une liste écrite à la main aurait vieilli au premier réglage
 * ajouté, et un contrôle qui vieillit cesse de mordre sans le dire.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");
/** Rayon de la fenêtre, en lignes : un paragraphe et son bloc de code. */
const FENETRE = 8;

/** Les clés de premier niveau des fragments de configuration rendus. */
const clesDesFragments = (): Set<string> => {
  const cles = new Set<string>();
  const presets = path.join(REPO_ROOT, "src", "nodefony", "templates", "app");
  for (const preset of readdirSync(presets)) {
    const dir = path.join(presets, preset, "nodefony", "config");
    if (!existsSync(dir)) continue;
    for (const fichier of readdirSync(dir)) {
      if (!fichier.endsWith(".ts.tpl")) continue;
      const source = readFileSync(path.join(dir, fichier), "utf8");
      for (const ligne of source.split("\n")) {
        const m = /^\s*([A-Za-z][\w]{3,}):/u.exec(ligne);
        if (m) cles.add(m[1]);
      }
    }
  }
  return cles;
};

/** Tout ce qui PRESCRIT : le guide d'agent généré, et les skills livrés. */
const fichiersPrescripteurs = (): string[] => {
  const agents = path.join(
    REPO_ROOT,
    "src",
    "nodefony",
    "templates",
    "app",
    "agents",
  );
  const skills = path.join(
    REPO_ROOT,
    "src",
    "packages",
    "@nodefony",
    "devkit",
    "skills",
  );
  const liste = readdirSync(agents).map((f) => path.join(agents, f));
  for (const skill of readdirSync(skills)) {
    const fiche = path.join(skills, skill, "SKILL.md");
    if (existsSync(fiche)) liste.push(fiche);
  }
  return liste;
};

/**
 * Les prescriptions fautives d'un texte : le manifeste racine nommé à portée
 * d'une clé qui vit dans un fragment.
 *
 * @param texte - le contenu du fichier.
 * @param cles - les clés lues dans les fragments rendus.
 * @returns une entrée par faute, `ligne` étant numérotée à partir de 1.
 */
const prescriptionsFautives = (
  texte: string,
  cles: Set<string>,
): { ligne: number; cles: string[]; extrait: string }[] => {
  const lignes = texte.split("\n");
  const fautes: { ligne: number; cles: string[]; extrait: string }[] = [];
  for (const [i, ligne] of lignes.entries()) {
    if (!ligne.includes("nodefony.config.ts")) continue;
    // La ligne qui ÉNONCE ce qu'est ce fichier reste évidemment permise.
    if (ligne.includes("INDEX")) continue;
    const fenetre = lignes
      .slice(Math.max(0, i - FENETRE), i + FENETRE + 1)
      .join("\n");
    const trouvees = [...cles]
      // `clé:` — une DÉCLARATION, pas le mot cité en prose. Sans cette
      // exigence, « le cookie de session est `secure` » suffisait à faire
      // rougir une remarque parfaitement juste.
      .filter((k) => new RegExp(`(?<![\\w.])${k}\\s*:`, "u").test(fenetre))
      .sort();
    if (trouvees.length > 0)
      fautes.push({ ligne: i + 1, cles: trouvees, extrait: ligne.trim() });
  }
  return fautes;
};

describe("ce que le devkit PRESCRIT désigne le fichier qui porte la clé", () => {
  const cles = clesDesFragments();

  it("lit ses clés dans les fragments rendus, et en trouve", () => {
    // Un contrôle dont la liste est vide passe sur n'importe quoi.
    expect(cles.size).toBeGreaterThan(5);
    expect([...cles]).toContain("areas");
  });

  it("mord sur une prescription fautive (témoin)", () => {
    const temoin = [
      "Pour protéger un espace, ajoute une zone dans `nodefony.config.ts` :",
      "",
      "```ts",
      "areas: {",
      '  machine: { pattern: "^/api/machine" },',
      "}",
      "```",
    ].join("\n");
    const fautes = prescriptionsFautives(temoin, cles);
    expect(fautes).toHaveLength(1);
    expect(fautes[0]?.cles).toContain("areas");
  });

  it("ne mord PAS sur une mention légitime du manifeste (témoin)", () => {
    const temoin = [
      "Si la page annonce une autre origine, c'est qu'une `publicOrigin`",
      "explicite est configurée dans `nodefony.config.ts` — elle gagne toujours.",
    ].join("\n");
    expect(prescriptionsFautives(temoin, cles)).toHaveLength(0);
  });

  for (const fichier of fichiersPrescripteurs()) {
    const relatif = path.relative(REPO_ROOT, fichier).split(path.sep).join("/");
    it(`${relatif} n'envoie personne configurer un module dans le manifeste`, () => {
      const fautes = prescriptionsFautives(readFileSync(fichier, "utf8"), cles);
      expect(
        fautes,
        fautes
          .map(
            (f) =>
              `${relatif}:${f.ligne} — « ${f.extrait} » près de ${f.cles.join(", ")}` +
              " → nomme nodefony/config/<module>.ts, pas le manifeste",
          )
          .join("\n"),
      ).toEqual([]);
    });
  }

  it("ne nomme jamais la clé `firewalls.areas`, qui n'existe dans aucun schéma", () => {
    for (const fichier of fichiersPrescripteurs()) {
      expect(
        readFileSync(fichier, "utf8"),
        path.relative(REPO_ROOT, fichier),
      ).not.toContain("firewalls.areas");
    }
  });
});
