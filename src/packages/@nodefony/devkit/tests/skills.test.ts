import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";

/**
 * Ce que ces tests prouvent : les skills publiés décrivent une application
 * QUELCONQUE, et pas ce dépôt.
 *
 * Le défaut visé n'est pas théorique — il est arrivé, et un humain l'a attrapé à
 * l'œil : une sonde distribuée lisait l'attribut de thème d'une bibliothèque que
 * seule la console d'administration emploie, et devinait une route de connexion
 * qui n'existe que chez elle. Rien ne l'aurait signalé : le fichier part sur npm
 * tel quel, sans compilation ni exécution, et un lecteur pressé y voit du code
 * qui « marche » — il marche, ici, chez nous.
 *
 * D'où un contrôle qui porte sur le CONTENU de ce qu'on publie, avec deux
 * familles de motifs interdits, chacune payée par une panne réelle :
 *  1. le VOCABULAIRE DU DÉPÔT — chemins de nos sources, routes de Studio,
 *     bibliothèque de composants : dans une app, ils désignent le vide ;
 *  2. les OUTILS ABSENTS DE WINDOWS — `grep`, tubes, substitutions, ligne
 *     continuée : « dans les grosses boîtes ils n'ont que ça pour dev », et une
 *     commande qui n'y passe pas rend le skill inutilisable, pas juste gênant.
 */
const SKILLS = path.join(import.meta.dirname, "..", "skills");

/** Les skills publiés, lus sur le disque : la liste ne se tient pas à la main. */
const skills = readdirSync(SKILLS, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

/**
 * Tout ce qui est publié et destiné à être LU ou EXÉCUTÉ dans une application :
 * le `SKILL.md` et, s'il y en a, les scripts qu'il fait lancer.
 *
 * @param nom - le dossier du skill.
 * @returns les chemins absolus des fichiers à contrôler.
 */
function fichiersDe(nom: string): string[] {
  const base = path.join(SKILLS, nom);
  const out = [path.join(base, "SKILL.md")];
  const scripts = path.join(base, "scripts");
  if (!existsSync(scripts)) return out;
  const parcourir = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) parcourir(p);
      else if (p.endsWith(".mjs") || p.endsWith(".js")) out.push(p);
    }
  };
  parcourir(scripts);
  return out;
}

/**
 * Ce qu'un skill publié ne doit jamais contenir.
 *
 * Chaque motif est accompagné de ce qu'il faut faire à la place : un test qui
 * dit seulement « interdit » se fait contourner par le premier qui le croise.
 */
const INTERDITS: { motif: RegExp; pourquoi: string }[] = [
  {
    motif: /src\/packages\/@nodefony/u,
    pourquoi:
      "chemin des sources de ce dépôt — dans une app, le paquet vit sous node_modules/",
  },
  {
    motif: /\.claude\/skills/u,
    pourquoi:
      "les skills du dépôt sont un autre public ; un skill publié ne pointe pas vers eux",
  },
  {
    motif: /mantine|data-bs-theme/iu,
    pourquoi:
      "bibliothèque de composants de la console d'administration — lire le color-scheme CALCULÉ, ou laisser l'utilisateur sonder son propre attribut",
  },
  {
    motif: /\/nodefony\/(login|supervision|documentation)/u,
    pourquoi:
      "route de la console d'administration — une application n'a pas ces écrans (le chemin de connexion se DEMANDE, il ne se devine pas)",
  },
];

/**
 * Ce qu'une commande d'un skill publié ne doit jamais employer.
 *
 * Restreint aux blocs de code : la prose peut parler de `grep` sans que
 * personne n'ait à l'exécuter.
 */
const NON_PORTABLE: { motif: RegExp; pourquoi: string }[] = [
  { motif: /\|\s*grep\b/u, pourquoi: "`grep` n'existe pas dans cmd.exe" },
  {
    motif: /\$\([^)]+\)/u,
    pourquoi:
      "substitution de commande : ni cmd.exe ni PowerShell ne la lisent",
  },
  {
    motif: /\\\n/u,
    pourquoi:
      "ligne continuée par `\\` : le continuateur est ` (PowerShell) ou ^ (cmd)",
  },
];

/** Les blocs de code d'un markdown — c'est là, et seulement là, qu'on exige la portabilité. */
function blocsDeCode(src: string): string {
  return [...src.matchAll(/```[a-z]*\n([\s\S]*?)```/gu)]
    .map((m) => m[1])
    .join("\n");
}

describe("skills publiés", () => {
  it("il y en a, et chacun a son SKILL.md", () => {
    expect(skills.length).toBeGreaterThan(0);
    for (const nom of skills) {
      expect(
        existsSync(path.join(SKILLS, nom, "SKILL.md")),
        `${nom} n'a pas de SKILL.md`,
      ).toBe(true);
    }
  });

  it("porte le préfixe `nodefony-` — le dossier d'accueil est PARTAGÉ", () => {
    // Les pointeurs atterrissent dans le `.agents/skills/` de l'application,
    // c'est-à-dire là où l'utilisateur écrit AUSSI les siens. Sans namespace,
    // son `add-crud` métier et le nôtre se disputent un nom, et c'est `ai:sync`
    // qui écraserait le sien à la synchronisation suivante.
    for (const nom of skills) {
      expect(nom.startsWith("nodefony-"), `${nom} n'est pas préfixé`).toBe(
        true,
      );
    }
  });

  it("le nom du dossier est celui du frontmatter", () => {
    // Un écart fait ÉCARTER le skill par la découverte de `ai:sync` — en
    // silence : il ne serait tout simplement jamais posé dans l'application.
    for (const nom of skills) {
      const src = readFileSync(path.join(SKILLS, nom, "SKILL.md"), "utf8");
      expect(/^name:[ \t]*(\S.*)$/mu.exec(src)?.[1]?.trim(), nom).toBe(nom);
    }
  });

  it("ne parle ni de ce dépôt ni de la console d'administration", () => {
    for (const nom of skills) {
      for (const fichier of fichiersDe(nom)) {
        const src = readFileSync(fichier, "utf8");
        for (const { motif, pourquoi } of INTERDITS) {
          expect(
            motif.test(src),
            `${path.relative(SKILLS, fichier)} contient ${motif} — ${pourquoi}`,
          ).toBe(false);
        }
      }
    }
  });

  it("n'emploie que des commandes qui passent aussi sous Windows", () => {
    for (const nom of skills) {
      const src = blocsDeCode(
        readFileSync(path.join(SKILLS, nom, "SKILL.md"), "utf8"),
      );
      for (const { motif, pourquoi } of NON_PORTABLE) {
        expect(motif.test(src), `${nom}/SKILL.md — ${pourquoi}`).toBe(false);
      }
    }
  });

  it("copie ses scripts avec `/.` — sinon la seconde copie imbrique", () => {
    // Sans le `/.`, `docker cp dossier cible` crée `cible/dossier` quand la
    // cible existe déjà : on relance alors la version précédente du script en
    // croyant l'avoir mise à jour, sans le moindre message. Vécu.
    for (const nom of skills) {
      const src = readFileSync(path.join(SKILLS, nom, "SKILL.md"), "utf8");
      for (const ligne of src.split("\n")) {
        if (!ligne.includes("docker cp")) continue;
        expect(
          /docker cp \S+\/\.\s/u.test(ligne),
          `${nom} : ${ligne.trim()}`,
        ).toBe(true);
      }
    }
  });
});
