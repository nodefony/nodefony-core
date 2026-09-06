import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { anchorEventLoop, request } from "../cli/prompts";

/**
 * Ce que cette suite prouve : une commande qui pose une question ne peut plus
 * s'arrêter au milieu.
 *
 * Le défaut n'était visible NULLE PART en lisant le code — ni erreur, ni code
 * de sortie non nul, ni trace : Node constate que plus aucun handle n'est
 * actif et sort, laissant tout au plus un `Detected unsettled top-level await`.
 * Il ne frappait que les commandes qui ne démarrent rien, c'est-à-dire celles
 * qu'on a le plus soignées.
 */

const SRC = path.resolve(import.meta.dirname, "..");

/** Tous les `.ts` du cœur, hors bancs. */
function sources(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "tests" || entry === "node_modules") continue;
      sources(full, acc);
    } else if (entry.endsWith(".ts")) {
      acc.push(full);
    }
  }
  return acc;
}

describe("l'ancre d'event loop", () => {
  it("retient RÉELLEMENT le process, et le relâche", () => {
    // Un handle non `unref()` compte comme travail en cours pour Node — c'est
    // exactement ce qui manquait pendant une question.
    const avant = process.getActiveResourcesInfo().length;
    const relache = anchorEventLoop();
    expect(process.getActiveResourcesInfo().length).toBeGreaterThan(avant);
    relache();
    expect(process.getActiveResourcesInfo().length).toBe(avant);
  });

  it("relâche même quand l'interaction ÉCHOUE", async () => {
    // Ctrl+C, flux fermé, refus : sans le `finally`, on troquerait une commande
    // qui meurt trop tôt contre une qui ne rend jamais la main.
    const avant = process.getActiveResourcesInfo().length;
    await expect(
      request(async () => {
        throw new Error("interrompu");
      }),
    ).rejects.toThrow("interrompu");
    expect(process.getActiveResourcesInfo().length).toBe(avant);
  });

  it("rend ce que l'interaction rend", async () => {
    expect(await request(async () => "réponse")).toBe("réponse");
  });
});

describe("🔴 GATE — personne ne pose de question hors de la porte", () => {
  it("aucun import direct de @inquirer/prompts dans le cœur", () => {
    // La règle ne tient que si elle est IMPOSSIBLE à contourner par
    // distraction : un import direct rétablit le défaut en silence, dans un
    // fichier que personne ne relira en pensant à l'event loop.
    const fautifs = sources(SRC)
      .filter((f) => !f.endsWith(path.join("cli", "prompts.ts")))
      .filter((f) => {
        const src = readFileSync(f, "utf8");
        // Un import de TYPE (`typeof import(...)`) ne pose aucune question : il
        // disparaît à la compilation. Seul l'import de VALEUR — celui qu'on
        // `await` — recrée le défaut.
        return /(?<!typeof\s)\bawait import\(["']@inquirer\/prompts["']\)/u.test(
          src,
        );
      });
    expect(
      fautifs.map((f) => path.relative(SRC, f)),
      "utiliser chargePrompts() de cli/prompts.ts",
    ).toEqual([]);
  });
});
