import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

/**
 * Le tableau de bord ne se lit JAMAIS par `gh project item-list` — ni dans un
 * script, ni dans un bloc de commande qu'un skill donne à exécuter.
 *
 * Ce contrôle est né d'un faux verdict rendu au user : la reprise de session a
 * annoncé un ticket du jalon `beta` comme « la prochaine chose » alors que neuf
 * tickets `alpha` restaient ouverts, dont un placé DEVANT lui dans l'ordre.
 * Cause : `gh project item-list --limit 120` avait rendu 120 lignes sur 261, le
 * tri portait sur ce sous-ensemble, et la troncature ne s'annonce jamais.
 *
 * La règle était pourtant écrite depuis longtemps (`nodefony-ticket`, § Pièges
 * vécus), et un gate frère l'imposait déjà — mais aux seuls scripts `.mjs` du
 * dossier voisin. La prose des skills, elle, n'était relue par personne : c'est
 * exactement là que la commande interdite avait survécu, dans le skill que
 * l'agent exécute à CHAQUE reprise. Un gate ne protège que le périmètre qu'il
 * balaye ; celui-ci balaye tout l'outillage agent.
 *
 * La voie sûre est unique : `board-snapshot.mjs` (GraphQL PAGINÉ), dont
 * `.ai/BOARD.md` est l'empreinte.
 */

const ici = path.dirname(url.fileURLToPath(import.meta.url));
const racineSkills = path.resolve(ici, "../../..");

/** Tous les fichiers d'un suffixe donné sous `.claude/skills`, hors dossiers lourds. */
const balayer = (suffixe, exclure = () => false) => {
  const trouves = [];
  const descendre = (dossier) => {
    for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
      const complet = path.join(dossier, entree.name);
      if (entree.isDirectory()) {
        if (entree.name === "node_modules") continue;
        descendre(complet);
      } else if (entree.name.endsWith(suffixe) && !exclure(entree.name)) {
        trouves.push(complet);
      }
    }
  };
  descendre(racineSkills);
  return trouves;
};

const relatif = (f) => path.relative(racineSkills, f);

/** Retire commentaires de ligne et de bloc — une MENTION n'est pas un appel. */
const sansCommentaires = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * Les blocs de code d'un markdown — c'est ce qu'un agent EXÉCUTE. La prose qui
 * documente le piège doit rester libre de le nommer, sans quoi le gate rendrait
 * la leçon inécrivable.
 */
const blocsDeCode = (markdown) => {
  const blocs = [];
  const motif = /^[ \t]*```[^\n]*\n([\s\S]*?)^[ \t]*```/gm;
  let trouve;
  while ((trouve = motif.exec(markdown)) !== null) blocs.push(trouve[1]);
  return blocs;
};

describe("le tableau de bord ne se lit pas par `gh project item-list`", () => {
  const scripts = balayer(".mjs", (n) => n.endsWith(".test.mjs"));
  const pages = balayer(".md");

  // Sans ces deux planchers, un balayage cassé rendrait un vert vide.
  it("le balayage trouve bien des scripts ET des pages", () => {
    expect(scripts.length).toBeGreaterThan(20);
    expect(pages.length).toBeGreaterThan(50);
  });

  it("aucun script de l'outillage agent ne l'appelle", () => {
    const fautifs = scripts.filter((f) =>
      /["']item-list["']/.test(sansCommentaires(fs.readFileSync(f, "utf8"))),
    );
    expect(fautifs.map(relatif)).toEqual([]);
  });

  // Une ligne portant `CONTRE-EXEMPLE` reste permise : montrer la commande
  // fautive est parfois la seule façon d'enseigner le piège.
  it("aucun bloc de commande d'un skill ne le prescrit", () => {
    const fautifs = [];
    for (const page of pages) {
      for (const bloc of blocsDeCode(fs.readFileSync(page, "utf8"))) {
        for (const ligne of bloc.split("\n")) {
          if (
            ligne.includes("item-list") &&
            !ligne.includes("CONTRE-EXEMPLE")
          ) {
            fautifs.push(`${relatif(page)} → ${ligne.trim()}`);
          }
        }
      }
    }
    expect(fautifs).toEqual([]);
  });
});
