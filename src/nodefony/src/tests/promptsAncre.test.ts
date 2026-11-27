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

/** `src/` du dépôt : le cœur ET les paquets, dont les commandes posent aussi des questions. */
const REPO_SRC = path.resolve(SRC, "..", "..");

/** Les `.ts` de production du dépôt — ni bancs, ni sorties de build. */
function productionSources(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (
      entry === "node_modules" ||
      entry === "dist" ||
      entry === "tests" ||
      entry.startsWith(".")
    ) {
      continue;
    }
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) productionSources(full, acc);
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      acc.push(full);
    }
  }
  return acc;
}

/** Le code sans ses commentaires : une garde EXPLIQUÉE n'est pas une garde posée. */
function codeOf(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/(^|[^:])\/\/[^\n]*/gu, "$1");
}

/**
 * Les fichiers (chemins en `/`, relatifs à `src/`) dont le code mord sur
 * `pattern` hors exceptions — et les exceptions que rien n'active plus, qui
 * mentiraient.
 */
function offenders(
  pattern: RegExp,
  allowed: ReadonlySet<string>,
): { offending: string[]; idle: string[] } {
  const biting = productionSources(REPO_SRC)
    .map((f) => path.relative(REPO_SRC, f).split(path.sep).join("/"))
    .filter((rel) => pattern.test(codeOf(path.join(REPO_SRC, rel))));
  return {
    offending: biting.filter((rel) => !allowed.has(rel)),
    idle: [...allowed].filter((rel) => !biting.includes(rel)),
  };
}

describe("🔴 GATE — une question passe par `ask()` (#538 lot 2b-1)", () => {
  it("aucune garde « stdin est-il un terminal ? » hors de la porte", () => {
    // Quinze gardes recopiées tranchaient, chacune à sa façon, « peut-on
    // demander ? » — l'une oubliait `NF_NO_TTY`, l'autre la sortie. `canAsk()`
    // est la seule réponse ; une garde neuve la rouvre en silence.
    const allowed = new Set([
      // La porte elle-même.
      "nodefony/src/cli/ask.ts",
      // Le clavier brut du superviseur : des raccourcis, pas une question.
      "nodefony/src/service/dev/DevSupervisor.ts",
    ]);
    const found = offenders(
      /\bstdin\??\.isTTY\b|isTerminal\(\s*(?:process\.)?stdin\b/u,
      allowed,
    );
    expect(
      found.offending,
      "constater le terminal par canAsk() de cli/ask.ts",
    ).toEqual([]);
    expect(found.idle, "exception sans objet : la retirer").toEqual([]);
  });

  it("inquirer n'est plus appelé que par le menu (D5)", () => {
    // Déprécié en 10.1, retiré en 11.0 : un appel neuf serait une question de
    // plus à migrer, avec un rendu et une annulation qui ne sont pas les nôtres.
    const allowed = new Set([
      // La porte d'inquirer, gardée pour la série 10.
      "nodefony/src/cli/prompts.ts",
      "nodefony/src/cli/promptPassword.ts",
      // `Command.prompts` / `loadPrompts`, dépréciés mais tenus à l'identique.
      "nodefony/src/command/Command.ts",
      // `nodefony menu` reste sur inquirer (D5).
      "nodefony/src/kernel/commands/MenuCommand.ts",
    ]);
    const found = offenders(
      /\.prompts\b(?!\s*[:=])|\bchargePrompts\(|\.loadPrompts\(|\baskPasswordMasked\(/u,
      allowed,
    );
    expect(
      found.offending,
      "poser la question par ask() ou Command.ask()",
    ).toEqual([]);
    expect(found.idle, "exception sans objet : la retirer").toEqual([]);
  });
});
