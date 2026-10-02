/**
 * Gate — aucun workflow du dépôt n'arrête de lui-même une exécution en cours.
 *
 * Une annulation s'affiche comme des jobs arrêtés net, et laisse le commit sans
 * verdict : la garde de publication (`verdictCiDuCommit`) compte un `cancelled`
 * ROUGE. Vécu à chaque release : des runs `dev` coupés au moment où l'on publie.
 * Le dépôt est public, la CI gratuite : annuler n'économise rien.
 *
 * Forme admise : pas d'annulation (`false` ou absente), ou annulation réservée
 * aux pull requests — là seulement, l'exécution précédente est caduque.
 * Un groupe propre à une branche ne suffit pas : il annulerait encore entre deux
 * pushes de la même branche, c'est-à-dire en pleine session.
 *
 * Les gabarits d'application (`templates/**`) ne sont PAS concernés : le dépôt
 * d'un utilisateur peut être privé, ses minutes payantes.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DIR = path.join(ROOT, ".github", "workflows");
const PR_ONLY = "${{ github.event_name == 'pull_request' }}";

const workflows = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f));

describe("CI — aucune exécution annulée par une autre", () => {
  it("lit au moins les workflows connus", () => {
    expect(workflows).toContain("node.js.yml");
  });

  for (const file of workflows) {
    it(`${file} : pas d'annulation, sauf entre exécutions d'une même pull request`, () => {
      const wf = parse(readFileSync(path.join(DIR, file), "utf8")) ?? {};
      const blocks = [
        ["workflow", wf.concurrency],
        ...Object.entries(wf.jobs ?? {}).map(([id, job]) => [
          `job ${id}`,
          job?.concurrency,
        ]),
      ];
      for (const [where, c] of blocks) {
        if (c === undefined || c === null || typeof c === "string") continue;
        const cancel = c["cancel-in-progress"];
        expect(
          cancel === undefined || cancel === false || cancel === PR_ONLY,
          `${file} (${where}) : cancel-in-progress = ${JSON.stringify(cancel)}`,
        ).toBe(true);
        if (cancel === PR_ONLY) {
          // Annuler entre PR suppose un groupe qui ne réunit QUE la PR : pour un
          // push, il doit être propre à l'exécution.
          expect(String(c.group), `${file} (${where}) : groupe`).toContain(
            "github.run_id",
          );
        }
      }
    });
  }
});
