/**
 * **Un pointeur POINTE — il ne recopie pas.**
 *
 * Chaque agent qui n'ouvre pas `AGENTS.md` d'office reçoit un fichier à son nom,
 * et la tentation permanente est d'y « remettre l'essentiel pour qu'il l'ait
 * sous les yeux ». Ce serait une SECONDE source : elle ne lèverait aucune
 * erreur, elle vieillirait, et l'agent qui la lit travaillerait sur des
 * instructions périmées sans que personne le sache — précisément le mode de
 * défaillance que la précédence « le plus proche gagne » aggrave, puisque c'est
 * la copie qui gagnerait.
 *
 * Le contrôle porte sur les GABARITS plutôt que sur une application rendue :
 * c'est là que la duplication s'écrirait, et le gabarit est la seule chose que
 * tous les projets générés ont en commun.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { AGENT_TARGETS } from "../cli/agentTargets";

const TPL = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "templates",
  "app",
  "agents",
);

/**
 * Longueur à partir de laquelle une phrase identique n'est plus une
 * coïncidence.
 *
 * Les deux gabarits partagent légitimement des commandes (`npm run verify`) et
 * des noms (`AGENTS.md`) : comparer des FRAGMENTS accuserait du texte juste, et
 * un contrôle qui crie faux apprend à passer outre. Une phrase entière de
 * soixante caractères, elle, ne se retrouve à l'identique que par copie.
 */
const PHRASE_MIN = 60;

/** Les phrases d'un gabarit, tags eta retirés et blancs normalisés. */
function phrases(source: string): string[] {
  const texte = source
    .replace(/<%[^%]*%>/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  return texte
    .split(/(?<=[.!?])\s+/u)
    .map((p) => p.trim())
    .filter((p) => p.length >= PHRASE_MIN);
}

describe("pointeurs d'instructions d'agent", () => {
  const agents = readFileSync(path.join(TPL, "AGENTS.md.tpl"), "utf8");
  const pointeur = readFileSync(path.join(TPL, "POINTEUR.md.tpl"), "utf8");

  it("🔴 le pointeur ne RECOPIE aucune phrase d'AGENTS.md", () => {
    const source = new Set(phrases(agents));
    const copiees = phrases(pointeur).filter((p) => source.has(p));
    expect(
      copiees,
      `phrase(s) recopiée(s) depuis AGENTS.md — un pointeur pointe :\n` +
        copiees.map((p) => `  · ${p}`).join("\n"),
    ).toEqual([]);
  });

  it("reste un POINTEUR : il nomme AGENTS.md et tient en quelques lignes", () => {
    expect(pointeur).toContain("AGENTS.md");
    // Une borne de taille, parce que la duplication commence toujours par « je
    // n'ajoute qu'un paragraphe ». Elle n'a pas à être fine : l'ordre de
    // grandeur sépare un renvoi d'une copie.
    expect(pointeur.split("\n").length).toBeLessThan(30);
  });

  it("chaque agent NON natif déclare où son pointeur doit être écrit", () => {
    for (const target of AGENT_TARGETS) {
      if (target.instructions.natif) continue;
      expect(target.instructions.file, target.key).toBeTruthy();
      // Un chemin qui VOYAGE s'écrit en `/` : cette valeur part dans la table,
      // dans le compte rendu et dans la documentation ; c'est l'appelant qui la
      // `path.join` pour ouvrir le fichier.
      expect(target.instructions.file, target.key).not.toContain("\\");
      // La preuve est ce qui se re-vérifie le jour où l'agent change d'avis.
      expect(target.instructions.proof.length, target.key).toBeGreaterThan(20);
    }
  });

  it("🔴 un agent natif ne reçoit AUCUN fichier — sinon c'est du vide qui diverge", () => {
    for (const target of AGENT_TARGETS) {
      if (!target.instructions.natif) continue;
      expect(target.instructions.file, target.key).toBe("AGENTS.md");
    }
  });
});
