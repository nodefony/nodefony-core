import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { printUsage, printUsageError, type IUsagePage } from "./usageReport";
import { SysExit } from "./sysexits";
import { findProjectRoot } from "./projectRoot";
import { stripGlobalCliFlags } from "./globalFlags";

/**
 * Le GRAPHE SYMBOLIQUE du framework — où le trouver, et comment l'interroger.
 *
 * `.ai/symbols.json` répond en O(1) à « que fait ce symbole, où est-il défini,
 * qui l'étend » — sans ouvrir un `.d.ts` ni parcourir des sources. C'est l'outil
 * qui évite à un agent de deviner ; encore faut-il qu'il EXISTE là où il
 * travaille.
 *
 * ## Le trou que ce fichier ferme
 *
 * Le graphe était produit à la racine du dépôt et lu là uniquement. Dans une
 * application installée depuis npm, ce fichier n'existe pas : la lecture rendait
 * une liste vide, sans rien dire. Le graphe est désormais **publié par le
 * paquet `nodefony`** — une application qui l'installe reçoit celui de tout le
 * framework, quelle que soit la combinaison de paquets qu'elle a choisie.
 *
 * La résolution essaie donc, dans l'ordre : le graphe du PROJET (cas du dépôt de
 * développement, où il est plus frais que tout), puis celui du framework
 * INSTALLÉ. Jamais un chemin en dur : c'est ce qui l'avait cassé.
 */

/** Emplacement conventionnel, relatif à une racine. */
const GRAPH_RELATIVE = path.join(".ai", "symbols.json");

/** Un symbole tel que le graphe le décrit (surface utile, pas le fichier entier). */
export interface ISymbolEntry {
  name: string;
  kind: string;
  /** Nom npm du paquet qui le porte (`@nodefony/http`, `@nodefony/core`). */
  module: string;
  /** Chemin du source, relatif à la racine du dépôt qui l'a produit. */
  file: string;
  line?: number;
  exported?: boolean;
  /** Première phrase du TSDoc — auto-suffisante par convention. */
  description?: string;
  extends?: string;
  implements?: string[];
}

/** Ce que le graphe contient, réduit à ce que ses lecteurs utilisent. */
export interface ISymbolsGraph {
  generated?: string;
  version?: string;
  symbols: Record<string, ISymbolEntry>;
  relations?: Record<string, Record<string, string[]>>;
}

/**
 * Trouve le graphe symbolique utilisable depuis `from`.
 *
 * @param from - dossier de départ (typiquement le cwd).
 * @returns le chemin du fichier, ou `null` si aucun graphe n'est atteignable.
 */
export function resolveSymbolsFile(from: string): string | null {
  const root = findProjectRoot(from) ?? from;
  // 1. Le graphe du projet lui-même — dans ce dépôt il décrit le code EN COURS
  //    d'écriture, donc il prime sur tout ce qui est installé.
  const local = path.join(root, GRAPH_RELATIVE);
  if (existsSync(local)) return local;
  // 2. Celui que le framework installé publie.
  const shipped = path.join(root, "node_modules", "nodefony", GRAPH_RELATIVE);
  if (existsSync(shipped)) return shipped;
  return null;
}

/**
 * Lit le graphe, ou `null` s'il est absent ou illisible.
 *
 * Ne lève jamais : un outil de découverte qui tombe sur un fichier corrompu doit
 * le DIRE à son appelant, pas interrompre ce qu'il diagnostiquait.
 *
 * @param from - dossier de départ de la résolution.
 */
export function readSymbolsGraph(from: string): ISymbolsGraph | null {
  const file = resolveSymbolsFile(from);
  if (file === null) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as ISymbolsGraph;
    return parsed.symbols ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Trouve un symbole par son nom exact.
 *
 * Le graphe indexe par nom, sauf pour les **homonymes** qu'il range sous
 * `Module:Nom` — d'où le second passage, qui les rattrape. Extrait ici parce
 * que la commande n'est plus le seul lecteur : le serveur MCP interroge le même
 * graphe, et deux résolutions d'homonymes finiraient par différer.
 *
 * @param graph - le graphe déjà lu
 * @param name - nom exact recherché
 * @returns l'entrée, ou `undefined`
 */
export function lookupSymbol(
  graph: ISymbolsGraph,
  name: string,
): ISymbolEntry | undefined {
  return (
    graph.symbols[name] ??
    Object.values(graph.symbols).find((s) => s.name === name)
  );
}

/** Ce que la ligne de commande demande. */
interface ISymbolsRequest {
  /** Nom exact d'un symbole, ou `null` pour un résumé. */
  name: string | null;
  json: boolean;
  /** Filtre par paquet (`--module @nodefony/http`). */
  module: string | null;
  cwd: string;
  /** `true` si l'on veut seulement la page d'aide. */
  help: boolean;
}

/** La page d'aide — `nodefony symbols --help`, et le rappel après un refus. */
const PAGE: IUsagePage = {
  command: "nodefony symbols",
  tagline:
    "interroge le graphe symbolique : où un symbole est défini, ce qu'il " +
    "fait, et de qui il hérite",
  synopsis: ["nodefony symbols [<Symbole>] [options]"],
  sections: [
    {
      title: "CE QU'ELLE LIT",
      paragraph:
        "Un fichier JSON — le graphe engendré par le dépôt — et rien d'autre. " +
        "Sans nom de symbole, elle rend un résumé du graphe. Elle ne DÉMARRE " +
        "pas l'application : elle répond donc quand celle-ci ne démarre plus, " +
        "le moment où l'on cherche justement ce que fait une classe.",
    },
  ],
  options: [
    { term: "-j, --json", text: "la même réponse, exploitable par un script" },
    { term: "-m, --module <nom>", text: "n'afficher qu'un paquet" },
    {
      term: "--cwd <chemin>",
      text: "point de départ (la racine de l'app est résolue en remontant)",
    },
  ],
  examples: [
    { term: "nodefony symbols", text: "ce que contient le graphe" },
    {
      term: "nodefony symbols Kernel",
      text: "où Kernel est défini, et sa parenté",
    },
    {
      term: "nodefony symbols -m @nodefony/http",
      text: "les symboles d'un seul paquet",
    },
  ],
  exitCodes: [
    {
      term: "66",
      text: "aucun graphe ici — le dépôt ne l'a pas engendré (EX_NOINPUT)",
    },
  ],
};

/**
 * Parse l'argv après le mot `symbols`.
 *
 * @param argv - `process.argv` complet.
 * @returns la demande, ou le motif du refus.
 */
export function parseSymbolsArgv(
  argv: string[],
): ISymbolsRequest | { error: string } {
  const at = argv.indexOf("symbols");
  const rest = stripGlobalCliFlags(at === -1 ? [] : argv.slice(at + 1));
  const req: ISymbolsRequest = {
    name: null,
    json: false,
    module: null,
    cwd: process.cwd(),
    help: false,
  };
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i];
    if (word === "--help" || word === "-h") {
      // Une commande qui répond « option inconnue : --help » apprend au
      // lecteur à ne plus croire le pied de l'aide, qui promet ce drapeau.
      req.help = true;
    } else if (word === "--json" || word === "-j") {
      req.json = true;
    } else if (word === "--module" || word === "-m") {
      req.module = rest[++i] ?? null;
    } else if (word === "--cwd") {
      req.cwd = path.resolve(rest[++i] ?? "");
    } else if (word.startsWith("-")) {
      return { error: `option inconnue : ${word}` };
    } else if (req.name === null) {
      req.name = word;
    } else {
      return { error: `argument en trop : ${word}` };
    }
  }
  return req;
}

/** Rend un symbole pour un lecteur humain — une ligne d'identité, puis la parenté. */
function renderSymbol(sym: ISymbolEntry): string {
  const lines = [
    `${sym.name} — ${sym.kind} (${sym.module})`,
    `  ${sym.file}${sym.line ? `:${sym.line}` : ""}`,
  ];
  if (sym.description) lines.push(`  ${sym.description}`);
  if (sym.extends) lines.push(`  étend      : ${sym.extends}`);
  if (sym.implements?.length) {
    lines.push(`  implémente : ${sym.implements.join(", ")}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Commande `nodefony symbols` — le graphe, sans boot et sans dépôt.
 *
 * Trois usages, du plus fréquent au plus rare : un nom (« qu'est-ce que
 * `AbstractCrudService` ? »), un paquet (`--module @nodefony/http` : sa surface
 * exportée), rien (le résumé — d'où vient le graphe, ce qu'il couvre).
 *
 * @param argv - `process.argv` complet.
 * @returns exit code sémantique (`OK`, `USAGE`, `NOINPUT` si aucun graphe,
 *   `DATAERR` si le symbole demandé est introuvable).
 */
export function runSymbolsCommand(argv: string[]): number {
  const parsed = parseSymbolsArgv(argv);
  if ("error" in parsed) {
    return printUsageError(PAGE, parsed.error);
  }
  if (parsed.help) {
    return printUsage(PAGE);
  }
  const file = resolveSymbolsFile(parsed.cwd);
  const graph = readSymbolsGraph(parsed.cwd);
  if (graph === null) {
    // Dire QUE le graphe manque, et POURQUOI c'est réparable : le silence
    // laisserait croire que le symbole cherché n'existe pas.
    process.stderr.write(
      `symbols: aucun graphe symbolique atteignable.\n` +
        `  Il est publié par le paquet nodefony (node_modules/nodefony/.ai/symbols.json)\n` +
        `  et régénérable dans ce dépôt par : npm run generate-symbols\n`,
    );
    return SysExit.NOINPUT;
  }

  if (parsed.name !== null) {
    const sym = lookupSymbol(graph, parsed.name);
    if (!sym) {
      process.stderr.write(
        `symbols: « ${parsed.name} » est introuvable dans le graphe (${Object.keys(graph.symbols).length} symboles).\n`,
      );
      return SysExit.DATAERR;
    }
    process.stdout.write(
      parsed.json ? `${JSON.stringify(sym, null, 2)}\n` : renderSymbol(sym),
    );
    return SysExit.OK;
  }

  const entries = Object.values(graph.symbols).filter(
    (s) => parsed.module === null || s.module === parsed.module,
  );
  if (parsed.json) {
    process.stdout.write(`${JSON.stringify(entries, null, 2)}\n`);
    return SysExit.OK;
  }
  if (parsed.module !== null) {
    for (const sym of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      process.stdout.write(
        `  ${sym.name.padEnd(34)} ${sym.kind}${sym.description ? ` — ${sym.description}` : ""}\n`,
      );
    }
    process.stdout.write(`\n${entries.length} symbole(s) — ${parsed.module}\n`);
    return SysExit.OK;
  }

  // Résumé : d'où vient le graphe (la question qu'on se pose en premier quand un
  // symbole manque), et ce qu'il couvre.
  const byPackage = new Map<string, number>();
  for (const sym of entries) {
    byPackage.set(sym.module, (byPackage.get(sym.module) ?? 0) + 1);
  }
  process.stdout.write(`graphe : ${file}\n`);
  if (graph.generated) process.stdout.write(`généré : ${graph.generated}\n`);
  process.stdout.write(`${entries.length} symboles exportés\n\n`);
  for (const [mod, n] of [...byPackage].sort((a, b) => b[1] - a[1])) {
    process.stdout.write(`  ${String(n).padStart(5)}  ${mod}\n`);
  }
  process.stdout.write(
    `\nUn symbole : nodefony symbols AbstractCrudService\n` +
      `Un paquet  : nodefony symbols --module @nodefony/http\n`,
  );
  return SysExit.OK;
}
