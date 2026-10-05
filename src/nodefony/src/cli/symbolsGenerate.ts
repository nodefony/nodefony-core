import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildSymbolsGraph,
  readSourceInputs,
  readSymbolsProducer,
  SYMBOLS_PRODUCER_APPLICATION,
  writeFileAtomic,
  type TypeScriptApi,
} from "./symbolsGraph";
import {
  packageManagerCommandLines,
  resolvePackageManager,
} from "./packageManager";
import { SysExit } from "./sysexits";

/**
 * `nodefony symbols --generate` — le graphe symbolique du code d'une
 * APPLICATION.
 *
 * Le framework publie le graphe de SES modules ; celui des modules de
 * l'application, rien ne le produisait — l'onglet « API » de leur fiche restait
 * vide dans la console d'administration. Cette commande l'écrit dans
 * `<app>/.ai/symbols.json`, que `readSymbolsGraph` fusionne déjà avec celui du
 * framework.
 *
 * L'extraction est celle du dépôt du framework (`symbolsGraph.ts`), exécutée
 * avec le compilateur TypeScript de l'APPLICATION : aucune dépendance
 * d'exécution n'est ajoutée au framework pour un outil de développement.
 */

/** Ce qu'on analyse dans une application — racine, puis chaque module local. */
export const APP_SYMBOLS_INCLUDE: readonly string[] = [
  "index.ts",
  "nodefony/**/*.ts",
  "src/**/*.ts",
  "modules/*/index.ts",
  "modules/*/nodefony/**/*.ts",
  "modules/*/src/**/*.ts",
];

/** Ce qu'on écarte : dépendances, sorties, tests, déclarations, frontends. */
export const APP_SYMBOLS_EXCLUDE: readonly string[] = [
  "**/node_modules/**",
  "**/dist/**",
  "**/tests/**",
  "**/*.test.ts",
  "**/*.spec.ts",
  "**/*.d.ts",
  "**/*.config.ts",
  "**/frontend/**",
];

/** Emplacement du graphe, relatif à la racine de l'application. */
const GRAPH_RELATIVE = path.join(".ai", "symbols.json");

/** Issue d'une génération. */
export type IGenerateSymbolsOutcome =
  | {
      ok: true;
      /** Chemin absolu du graphe écrit. */
      file: string;
      files: number;
      /** Symboles EXPORTÉS, ceux que lit la console d'administration. */
      exported: number;
      /** Nombre de symboles par module. */
      modules: Record<string, number>;
      skipped: { file: string; bytes: number }[];
    }
  | { ok: false; code: number; message: string };

/**
 * Charge le module `typescript` installé dans l'APPLICATION.
 *
 * Cherché dans les `node_modules` de l'application, en remontant — jamais
 * depuis le framework : c'est elle qui choisit sa version du compilateur, et un
 * gestionnaire strict (pnpm) ne laisserait pas `nodefony` atteindre une
 * dépendance qu'il ne déclare pas.
 *
 * Lu sur le disque à chaque appel, et non par `require.resolve` : Node retient
 * pour toute la vie du processus qu'un `package.json` était ABSENT. Le
 * superviseur de développement, qui dure, n'aurait alors jamais vu un
 * `typescript` installé après son démarrage.
 *
 * @param root - racine de l'application.
 * @returns le compilateur, ou `null` s'il n'est pas installé.
 */
export async function loadProjectTypeScript(
  root: string,
): Promise<TypeScriptApi | null> {
  let entry: string | null = null;
  for (let dir = path.resolve(root); ; dir = path.dirname(dir)) {
    const pkgDir = path.join(dir, "node_modules", "typescript");
    try {
      const pkg: unknown = JSON.parse(
        fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"),
      );
      const main =
        typeof pkg === "object" &&
        pkg !== null &&
        "main" in pkg &&
        typeof pkg.main === "string"
          ? pkg.main
          : "lib/typescript.js";
      entry = path.join(pkgDir, main);
      break;
    } catch {
      // Absent à ce niveau : on remonte, comme la résolution de Node.
    }
    if (path.dirname(dir) === dir) break;
  }
  if (entry === null) return null;
  // `import()` prend une URL : un chemin `D:\…` y serait lu comme un protocole.
  const loaded: unknown = await import(pathToFileURL(entry).href);
  const api =
    typeof loaded === "object" && loaded !== null && "default" in loaded
      ? loaded.default
      : loaded;
  if (
    typeof api !== "object" ||
    api === null ||
    !("createSourceFile" in api) ||
    typeof api.createSourceFile !== "function"
  ) {
    return null;
  }
  return api as TypeScriptApi;
}

/**
 * Module qui porte un fichier : le `name` du `package.json` le plus proche —
 * celui de l'application pour son propre code, celui de `modules/<nom>` pour
 * un module local. C'est la clé que lit la console d'administration
 * (`Module.getModuleName()`).
 *
 * @param root - racine de l'application.
 * @returns la fonction de projection, avec un cache par dossier.
 */
export function projectModuleResolver(root: string): (file: string) => string {
  const cache = new Map<string, string | null>();
  const nameIn = (dir: string): string | null => {
    const known = cache.get(dir);
    if (known !== undefined) return known;
    let name: string | null = null;
    try {
      const pkg: unknown = JSON.parse(
        fs.readFileSync(path.join(dir, "package.json"), "utf8"),
      );
      if (
        typeof pkg === "object" &&
        pkg !== null &&
        "name" in pkg &&
        typeof pkg.name === "string"
      ) {
        name = pkg.name;
      }
    } catch {
      name = null;
    }
    cache.set(dir, name);
    return name;
  };
  const fallback = path.basename(root);
  return (file: string): string => {
    let dir = path.dirname(path.join(root, file));
    for (;;) {
      const name = nameIn(dir);
      if (name !== null) return name;
      if (dir === root || path.dirname(dir) === dir) return fallback;
      dir = path.dirname(dir);
    }
  };
}

/**
 * Engendre et écrit le graphe symbolique d'une application.
 *
 * @param root - racine de l'application (portant `nodefony.config.ts`).
 * @param tsApi - compilateur à employer ; par défaut celui de l'application.
 * @returns ce qui a été écrit, ou le motif du refus (compilateur absent).
 */
export async function generateProjectSymbols(
  root: string,
  tsApi?: TypeScriptApi | null,
): Promise<IGenerateSymbolsOutcome> {
  const file = path.join(root, GRAPH_RELATIVE);
  const producer = readSymbolsProducer(file);
  if (producer !== null && producer !== SYMBOLS_PRODUCER_APPLICATION) {
    // Le dépôt du framework est aussi une application de développement : son
    // graphe décrit TOUT le framework, et le code applicatif seul le viderait.
    return {
      ok: false,
      code: SysExit.CANTCREAT,
      message:
        `${file} a été produit par un autre outil (« ${producer || "inconnu"} ») ; il n'est pas réécrit.\n` +
        `  Dans le dépôt du framework : npm run generate-symbols\n`,
    };
  }
  const ts = tsApi ?? (await loadProjectTypeScript(root));
  if (ts === null) {
    const pm = resolvePackageManager({ dir: root }).name;
    return {
      ok: false,
      code: SysExit.UNAVAILABLE,
      message:
        `le compilateur TypeScript est introuvable depuis ${root}.\n` +
        `  Il sert à lire le code de l'application ; l'installer :\n` +
        `    ${packageManagerCommandLines(pm).add("-D typescript")}\n`,
    };
  }
  const matched = fs.globSync([...APP_SYMBOLS_INCLUDE], {
    cwd: root,
    exclude: [...APP_SYMBOLS_EXCLUDE],
  });
  const { inputs, skipped } = readSourceInputs(
    root,
    matched,
    projectModuleResolver(root),
  );
  const { stable } = buildSymbolsGraph(
    ts,
    inputs,
    SYMBOLS_PRODUCER_APPLICATION,
  );
  writeFileAtomic(file, `${JSON.stringify(stable, null, 2)}\n`);
  const modules: Record<string, number> = {};
  for (const sym of Object.values(stable.symbols)) {
    modules[sym.module] = (modules[sym.module] ?? 0) + 1;
  }
  return {
    ok: true,
    file,
    files: stable.stats.files,
    exported: Object.keys(stable.symbols).length,
    modules,
    skipped,
  };
}

/**
 * Régénère le graphe de l'application s'il lui APPARTIENT — le geste
 * automatique du superviseur de développement, au démarrage puis après chaque
 * reconstruction réussie.
 *
 * Ne réécrit jamais un graphe d'un autre producteur : dans le dépôt du
 * framework, qui est aussi une application de développement, `.ai/symbols.json`
 * décrit TOUT le framework, et le remplacer par celui du seul code applicatif
 * viderait la référence. Sans compilateur TypeScript, ne fait rien : un outil
 * d'appoint ne doit pas réclamer une installation à chaque rechargement.
 *
 * @param root - racine de l'application.
 * @returns l'issue de la génération, ou la raison pour laquelle elle n'a pas eu lieu.
 */
export async function refreshProjectSymbols(
  root: string,
): Promise<
  IGenerateSymbolsOutcome | { ok: false; skipped: "foreign" | "no-typescript" }
> {
  const producer = readSymbolsProducer(path.join(root, GRAPH_RELATIVE));
  if (producer !== null && producer !== SYMBOLS_PRODUCER_APPLICATION) {
    return { ok: false, skipped: "foreign" };
  }
  const ts = await loadProjectTypeScript(root);
  if (ts === null) return { ok: false, skipped: "no-typescript" };
  return generateProjectSymbols(root, ts);
}
