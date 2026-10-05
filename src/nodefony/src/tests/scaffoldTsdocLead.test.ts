/**
 * La première phrase du TSDoc d'un gabarit DÉCRIT ce qu'il génère.
 *
 * Elle est extraite seule par le graphe symbolique : c'est ce qu'affichent
 * `nodefony symbols <Nom>` et l'onglet « API » de la console d'administration.
 * Les gabarits de service s'ouvraient sur une consigne (« ⚡ Tu veux un
 * service ? Ne recopie pas ce fichier… ») : chaque service généré se décrivait
 * alors par une instruction de copie, dans toutes les applications.
 *
 * La recherche porte sur tout `templates/`, pas sur une liste : un gabarit
 * ajouté demain avec la même consigne en tête est pris d'office.
 */
import { describe, it, assert } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEMPLATES = fileURLToPath(new URL("../../templates", import.meta.url));

/** Marque de la consigne « génère-le plutôt que de recopier ». */
const INSTRUCTION = "Ne recopie pas ce fichier";

/** Première ligne de contenu de chaque bloc `/**` qui contient la consigne. */
function leadsOfInstructedBlocks(text: string): string[] {
  const leads: string[] = [];
  for (const block of text.matchAll(/\/\*\*\n([\s\S]*?)\*\//gu)) {
    const body = block[1] ?? "";
    if (!body.includes(INSTRUCTION)) continue;
    const first = body
      .split("\n")
      .map((l) => l.replace(/^\s*\*\s?/u, "").trim())
      .find((l) => l.length > 0);
    leads.push(first ?? "");
  }
  return leads;
}

describe("gabarits — la première phrase du TSDoc décrit, elle n'instruit pas", () => {
  const files = fs
    .globSync("**/*.tpl", { cwd: TEMPLATES })
    .map((f) => path.join(TEMPLATES, f))
    .filter((f) => fs.readFileSync(f, "utf8").includes(INSTRUCTION));

  it("la consigne existe bien dans des gabarits (sinon ce contrôle ne garde rien)", () => {
    assert.isAtLeast(files.length, 5, files.join("\n"));
  });

  it("⭐ aucun bloc ne s'ouvre sur la consigne", () => {
    const fautifs: string[] = [];
    for (const file of files) {
      for (const lead of leadsOfInstructedBlocks(
        fs.readFileSync(file, "utf8"),
      )) {
        if (lead.includes("⚡") || lead.includes(INSTRUCTION)) {
          fautifs.push(`${path.relative(TEMPLATES, file)} — « ${lead} »`);
        }
      }
    }
    assert.deepEqual(fautifs, []);
  });
});
