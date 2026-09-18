/**
 * Le protocole de ticket vit à UN seul endroit — `SKILL.md` §2 — et il est
 * désormais rendu DEUX fois : dans cette page, et dans les formulaires que
 * GitHub sert à qui ouvre une issue depuis l'interface.
 *
 * C'est exactement la duplication que le dépôt s'interdit ailleurs (une règle,
 * une implémentation). Ici elle est INÉVITABLE : GitHub ne sait pas lire notre
 * page, il veut ses propres fichiers. Quand une frontière impose la copie, la
 * règle du dépôt est d'y poser un test qui compare les deux sorties — sinon
 * elles divergent en silence, chacune marchant de son côté jusqu'au jour où
 * l'une des deux ment.
 *
 * Ce que ce gate NE fait pas : juger la rédaction des formulaires. Il vérifie
 * que les BLOCS du protocole y sont, et que les gardes qui protègent le
 * pilotage et le canal de sécurité n'ont pas été retirées par distraction.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ICI = dirname(fileURLToPath(import.meta.url));
const SKILL = join(ICI, "..", "SKILL.md");
const RACINE = join(ICI, "..", "..", "..", "..");
const FORMULAIRES = ["defaut.yml", "evolution.yml"].map((n) =>
  join(RACINE, ".github", "ISSUE_TEMPLATE", n),
);

const lire = (p) => readFileSync(p, "utf8");

/**
 * Les blocs du protocole, LUS dans le skill — jamais recopiés ici. Un test qui
 * porterait sa propre liste serait une TROISIÈME copie, et la plus sournoise :
 * il resterait vert en gardant deux fichiers d'accord sur une règle périmée.
 */
function blocsDuProtocole() {
  const md = lire(SKILL);
  // Le §2 : le premier bloc clôturé ```markdown qui suit le titre des quatre blocs.
  const section = md.slice(md.indexOf("## 2. Le corps"));
  const debut = section.indexOf("```markdown");
  // Le corps s'arrête au séparateur : ce qui suit (`Estimation`, `Dépend de`)
  // est de la MÉTADONNÉE de pilotage, pas un bloc du ticket — un formulaire
  // public n'a pas à la demander, et l'y chercher ferait crier le gate à tort.
  const fin = section.indexOf("\n---\n", debut);
  const bloc = section.slice(debut, fin);
  return [...bloc.matchAll(/^\*\*(.+?)\*\*$/gmu)].map((m) => m[1]);
}

describe("les formulaires GitHub rendent le protocole du skill", () => {
  const blocs = blocsDuProtocole();

  it("le skill porte bien trois blocs nommés (sinon l'extraction est muette)", () => {
    // Sans cette garde, un skill restructuré ferait rendre [] à l'extraction, et
    // toutes les assertions ci-dessous passeraient en ne vérifiant RIEN.
    expect(blocs).toEqual(["Le problème", "Preuve au terrain", "Fini quand"]);
  });

  for (const chemin of FORMULAIRES) {
    const nom = chemin.split("/").pop();

    it(`${nom} : chaque bloc du protocole est un champ du formulaire`, () => {
      const libelles = [...lire(chemin).matchAll(/^\s*label:\s*(.+)$/gmu)].map(
        (m) => m[1].trim(),
      );
      for (const bloc of blocs) expect(libelles).toContain(bloc);
    });

    it(`${nom} : les trois blocs sont OBLIGATOIRES`, () => {
      // Un champ facultatif se laisse vide, et le ticket redevient une opinion.
      const contenu = lire(chemin);
      expect(
        (contenu.match(/required: true/gu) ?? []).length,
      ).toBeGreaterThanOrEqual(blocs.length);
    });

    it(`${nom} : le titre pré-rempli suit Conventional Commits`, () => {
      expect(lire(chemin)).toMatch(/^title:\s*"[a-z]+\(portée\):\s"$/mu);
    });
  }
});

describe("les gardes que les formulaires ne doivent pas perdre", () => {
  const config = lire(join(RACINE, ".github", "ISSUE_TEMPLATE", "config.yml"));

  it("l'issue vierge reste fermée", () => {
    // Rouverte, elle rend la page blanche que ces formulaires existent pour
    // remplacer — et le protocole redevient invisible de l'extérieur.
    expect(config).toMatch(/^blank_issues_enabled:\s*false$/mu);
  });

  it("le canal de sécurité est le PREMIER lien proposé", () => {
    const liens = [...config.matchAll(/^\s*- name:\s*(.+)$/gmu)].map(
      (m) => m[1],
    );
    expect(liens.length).toBeGreaterThanOrEqual(2);
    expect(liens[0]).toMatch(/sécurité/iu);
  });

  it("aucun lien ne renvoie une faille vers un formulaire d'issue", () => {
    const bloc = config.slice(config.indexOf("contact_links"));
    const urlSecu = bloc.match(/url:\s*(\S+)/u)?.[1] ?? "";
    expect(urlSecu).toContain("/security/policy");
  });
});

describe("le skill NOMME les formulaires — sinon personne ne saura les tenir à jour", () => {
  it("SKILL.md renvoie vers .github/ISSUE_TEMPLATE", () => {
    // Le jumeau ne se maintient que si la source dit qu'il existe : une règle
    // qu'on édite sans savoir qu'elle est rendue ailleurs diverge au premier geste.
    expect(lire(SKILL)).toContain(".github/ISSUE_TEMPLATE");
  });
});
