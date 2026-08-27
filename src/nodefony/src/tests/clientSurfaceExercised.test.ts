/**
 * Sentinelle SYMÉTRIQUE de `clientSubpathSurface.types.test.ts`.
 *
 * Celle-là vérifie que le consommateur peut **nommer ce que la lib lui rend**.
 * Celle-ci vérifie l'inverse : que la lib **ne nomme rien qu'elle ne tienne**.
 *
 * Un type publié depuis `nodefony/client` est gelé SemVer — « chaque méthode
 * publiée est une promesse » (ADR-0007 D2). Or un contrat que **personne
 * n'exerce** n'a jamais été confronté au compilateur : ses trous ne se voient
 * pas, et la publication les grave pour toute la série majeure. C'est ce qui est
 * arrivé à `IClientKernel`, publié types-only sans une seule implémentation :
 * son registre ne pouvait pas nourrir `NodefonyProvider`, et il ne savait pas
 * exprimer le re-handshake d'identité de sa propre décision D9. Deux défauts
 * qu'un unique `implements` aurait fait tomber à la compilation.
 *
 * La règle : **une interface réexportée par le barrel client doit apparaître au
 * moins une fois dans les sources du dépôt ailleurs que dans sa déclaration.**
 * Republier depuis un autre barrel ne compte pas — les blocs de réexport sont
 * retirés avant le comptage : republier ne fait que propager la promesse.
 *
 * Périmètre = les `interface`s, et elles seules. Une interface décrit une FORME
 * que quelqu'un devra tenir ; un alias de type dérivé d'une valeur du dépôt
 * (`type PlatformChannel = (typeof PLATFORM_CHANNELS)[…]`) n'engage personne —
 * le compilateur le maintient vrai par construction, il suit sa source ou casse.
 * Les y soumettre ferait un gate qu'on apprend à contourner plutôt qu'à écouter.
 *
 * Ce que ce gate coûte à celui qui l'atteint : soit il exerce le contrat (une
 * implémentation, un test qui le consomme), soit il ne le publie pas encore.
 * Les deux issues sont bonnes ; publier à l'aveugle ne l'est pas.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

/** Racine du dépôt — ce test lit les sources de TOUS les workspaces. */
const REPO = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const BARREL = path.join(REPO, "src", "nodefony", "src", "client", "index.ts");

/** Chemin d'affichage : un chemin qui VOYAGE (message, ancre de doc) s'écrit en `/`. */
const show = (p: string): string =>
  path.relative(REPO, p).split(path.sep).join("/");

/**
 * Interfaces réexportées en `export type { … } from "…"` par le barrel client.
 *
 * La nature (interface ou alias) se lit dans le fichier qui DÉCLARE le type, pas
 * dans un artefact généré : `.ai/symbols.json` connaît le `kind`, mais un index
 * périmé rendrait un verdict faux sans le dire.
 */
function publishedInterfaces(barrel: string): string[] {
  const src = readFileSync(barrel, "utf8");
  const found: string[] = [];
  for (const block of src.matchAll(
    /export\s+type\s*\{([\s\S]*?)\}\s*from\s*"([^"]+)"/g,
  )) {
    const declaring = path.resolve(path.dirname(barrel), `${block[2]}.ts`);
    if (!existsSync(declaring)) continue;
    const code = readFileSync(declaring, "utf8");
    const body = block[1]
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    for (const raw of body.split(",")) {
      const name = raw
        .trim()
        .split(/\s+as\s+/)[0]
        .trim();
      if (!name) continue;
      if (new RegExp(`\\binterface\\s+${name}\\b`).test(code)) found.push(name);
    }
  }
  return found;
}

/**
 * Toutes les sources TypeScript du dépôt (hors artefacts et dépendances).
 *
 * Les entrées sont lues avec leur type (`withFileTypes`) : un lien symbolique ne
 * porte pas de source propre, et le suivre coûte ici un `ELOOP` — les fixtures
 * du `Finder` contiennent un cycle exprès.
 */
function sources(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.name === "node_modules" ||
      entry.name === "dist" ||
      entry.name === ".git" ||
      entry.isSymbolicLink()
    ) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      sources(full, acc);
    } else if (/\.(ts|tsx|mts)$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Retire ce qui ne prouve rien : commentaires (le TSDoc cite les types qu'il
 * décrit) et blocs de réexport (republier n'exerce pas un contrat).
 */
function meaningful(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/[^\n]*$/gm, "")
    .replace(/export\s+(?:type\s+)?\{[\s\S]*?\}\s*from\s*"[^"]+"\s*;?/g, "");
}

describe("surface publiée du barrel `nodefony/client`", () => {
  it("ne publie aucune interface que rien n'exerce dans le dépôt", () => {
    expect(existsSync(BARREL)).toBe(true);

    const published = publishedInterfaces(BARREL);
    expect(published.length).toBeGreaterThan(0);

    const alternation = published.join("|");
    // Groupe 1 = déclaration (elle ne prouve rien) ; groupe 2 = usage réel.
    const probe = new RegExp(
      `\\b(?:interface|type|class|enum)\\s+(${alternation})\\b|\\b(${alternation})\\b`,
      "g",
    );

    const exercised = new Set<string>();
    for (const file of sources(path.join(REPO, "src"))) {
      if (file === BARREL) continue; // le barrel publie, il n'exerce pas
      for (const hit of meaningful(readFileSync(file, "utf8")).matchAll(
        probe,
      )) {
        if (hit[2]) exercised.add(hit[2]);
      }
    }

    const orphans = published.filter((name) => !exercised.has(name));
    expect(
      orphans,
      `Interfaces publiées par ${show(BARREL)} que rien n'exerce : ${orphans.join(", ")}.\n` +
        "Un contrat jamais implémenté n'a jamais été vérifié par le compilateur, et le publier le gèle SemVer.\n" +
        "→ soit l'exercer (une implémentation, ou un test qui le consomme), soit ne pas le réexporter encore.",
    ).toEqual([]);
  });
});
