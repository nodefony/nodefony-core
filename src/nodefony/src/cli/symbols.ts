import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { printUsage, printUsageError, type IUsagePage } from "./usageReport";
import { SysExit } from "./sysexits";
import { findProjectRoot } from "./projectRoot";
import { stripGlobalCliFlags } from "./globalFlags";
import { generateProjectSymbols } from "./symbolsGenerate";

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
  /** Décorateurs appliqués (`injectable`, `Route`…). */
  decorators?: string[];
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

/** Lit un fichier de graphe, ou `null` s'il est illisible ou n'en est pas un. */
function readGraphFile(file: string): ISymbolsGraph | null {
  try {
    // Fichier généré par un autre outil, peut-être d'une autre version.
    const parsed = JSON.parse(
      readFileSync(file, "utf8"),
    ) as Partial<ISymbolsGraph>;
    const { symbols } = parsed;
    return symbols ? { ...parsed, symbols } : null;
  } catch {
    return null;
  }
}

/**
 * Lit le graphe atteignable depuis `from` — celui du PROJET fusionné avec celui
 * du framework INSTALLÉ —, ou `null` si aucun n'est lisible.
 *
 * Les deux se complètent au lieu de s'exclure : le graphe du projet décrit SES
 * modules, celui que publie `nodefony` décrit le framework. Choisir l'un aurait
 * vidé les autres — une application dotée de son propre graphe perdait toute la
 * référence du framework. Sur un même nom, le projet l'emporte : il décrit le
 * code en cours d'écriture.
 *
 * Ne lève jamais : un outil de découverte qui tombe sur un fichier corrompu doit
 * le DIRE à son appelant, pas interrompre ce qu'il diagnostiquait. Un graphe
 * illisible est ignoré, l'autre reste servi.
 *
 * @param from - dossier de départ de la résolution.
 */
export function readSymbolsGraph(from: string): ISymbolsGraph | null {
  const root = findProjectRoot(from) ?? from;
  const graphs = [
    path.join(root, "node_modules", "nodefony", GRAPH_RELATIVE),
    path.join(root, GRAPH_RELATIVE),
  ]
    .filter((file) => existsSync(file))
    .map(readGraphFile)
    .filter((g): g is ISymbolsGraph => g !== null);
  if (graphs.length === 0) return null;
  // Du moins prioritaire au plus prioritaire : le dernier écrit gagne le nom.
  const merged: ISymbolsGraph = { symbols: {} };
  for (const graph of graphs) {
    const { symbols, relations, ...meta } = graph;
    Object.assign(merged, meta);
    for (const [key, sym] of Object.entries(symbols)) {
      const taken = merged.symbols[key];
      // Un homonyme d'un AUTRE module (le `User` d'une application, celui du
      // framework) ne l'efface pas : il est rangé sous `Module:Nom`, comme le
      // générateur range les siens — sinon le symbole disparaissait de la
      // fiche de son module dans la console d'administration.
      if (
        taken !== undefined &&
        taken.module !== sym.module &&
        !key.includes(":")
      ) {
        merged.symbols[`${taken.module}:${taken.name}`] = taken;
      }
      merged.symbols[key] = sym;
    }
    for (const [kind, index] of Object.entries(relations ?? {})) {
      const into = (merged.relations ??= {})[kind] ?? {};
      for (const [target, sources] of Object.entries(index)) {
        into[target] = [...new Set([...(into[target] ?? []), ...sources])];
      }
      merged.relations[kind] = into;
    }
  }
  return merged;
}

/**
 * Trouve un symbole par son nom exact.
 *
 * Le graphe indexe par nom, sauf pour les **homonymes** qu'il range sous
 * `Module:Nom` — d'où le second passage, qui les rattrape. Puis le nom
 * PUBLIÉ : `export { Response as HttpResponse }` rend `Response` quand on
 * cherche `HttpResponse`, le nom qu'on lit dans un `import` (index
 * `relations.aliases`) — l'entrée rendue porte alors son nom de DÉCLARATION.
 * Extrait ici parce que la commande n'est plus le seul lecteur : le serveur
 * MCP interroge le même graphe, et deux résolutions finiraient par différer.
 *
 * @param graph - le graphe déjà lu
 * @param name - nom exact recherché (déclaré ou publié)
 * @returns l'entrée, ou `undefined`
 */
export function lookupSymbol(
  graph: ISymbolsGraph,
  name: string,
): ISymbolEntry | undefined {
  const direct =
    graph.symbols[name] ??
    Object.values(graph.symbols).find((s) => s.name === name);
  if (direct) return direct;
  for (const ref of graph.relations?.aliases?.[name] ?? []) {
    const at = ref.lastIndexOf(":");
    const module = ref.slice(0, at);
    const local = ref.slice(at + 1);
    const target = Object.values(graph.symbols).find(
      (s) => s.name === local && s.module === module,
    );
    if (target) return target;
  }
  return undefined;
}

/** Ce que la ligne de commande demande. */
interface ISymbolsRequest {
  /** Nom exact d'un symbole, ou `null` pour un résumé. */
  name: string | null;
  json: boolean;
  /** Filtre par paquet (`--module @nodefony/http`). */
  module: string | null;
  /** `--generate` : écrire le graphe du code de l'application. */
  generate: boolean;
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
  synopsis: [
    "nodefony symbols [<Symbole>] [options]",
    "nodefony symbols --generate [--json] [--cwd <chemin>]",
  ],
  sections: [
    {
      title: "CE QU'ELLE LIT",
      paragraph:
        "Des fichiers JSON — le graphe du framework et celui de l'application — et rien d'autre. " +
        "Sans nom de symbole, elle rend un résumé du graphe. Elle ne DÉMARRE " +
        "pas l'application : elle répond donc quand celle-ci ne démarre plus, " +
        "le moment où l'on cherche justement ce que fait une classe.",
    },
    {
      title: "D'OÙ VIENT LE GRAPHE",
      paragraph:
        "Celui du framework est publié avec le paquet nodefony. Celui de " +
        "l'application s'écrit par --generate dans .ai/symbols.json (ignoré " +
        "par git) : les deux sont lus ensemble, et la fiche « API » de chaque " +
        "module de l'application, dans la console d'administration, se " +
        "remplit. À relancer quand le code change. Il faut le compilateur " +
        "TypeScript de l'application (typescript, en dépendance de " +
        "développement).",
    },
  ],
  options: [
    { term: "-j, --json", text: "la même réponse, exploitable par un script" },
    { term: "-m, --module <nom>", text: "n'afficher qu'un paquet" },
    {
      term: "-g, --generate",
      text: "écrire le graphe du code de l'application",
    },
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
    {
      term: "nodefony symbols --generate",
      text: "décrire le code de l'application",
    },
  ],
  exitCodes: [
    {
      term: "66",
      text: "aucun graphe ici, ou --generate hors d'une application (EX_NOINPUT)",
    },
    {
      term: "69",
      text: "--generate sans le compilateur TypeScript (EX_UNAVAILABLE)",
    },
    {
      term: "73",
      text: "--generate face au graphe d'un autre outil, laissé intact (EX_CANTCREAT)",
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
    generate: false,
    cwd: process.cwd(),
    help: false,
  };
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i];
    if (word === undefined) break;
    if (word === "--help" || word === "-h") {
      // Une commande qui répond « option inconnue : --help » apprend au
      // lecteur à ne plus croire le pied de l'aide, qui promet ce drapeau.
      req.help = true;
    } else if (word === "--json" || word === "-j") {
      req.json = true;
    } else if (word === "--generate" || word === "-g") {
      req.generate = true;
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
  if (req.generate && (req.name !== null || req.module !== null)) {
    return {
      error: "--generate écrit le graphe : il ne prend ni symbole ni --module",
    };
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
  if (parsed.generate) {
    // La génération charge le compilateur : elle est asynchrone. Ne jamais
    // l'ignorer en silence — rendre un résumé ferait croire à une écriture.
    return printUsageError(
      PAGE,
      "--generate passe par runSymbolsCli (asynchrone), pas par runSymbolsCommand",
    );
  }
  const file = resolveSymbolsFile(parsed.cwd);
  const graph = readSymbolsGraph(parsed.cwd);
  if (graph === null) {
    // Dire QUE le graphe manque, et POURQUOI c'est réparable : le silence
    // laisserait croire que le symbole cherché n'existe pas.
    process.stderr.write(
      `symbols: aucun graphe symbolique atteignable.\n` +
        `  Il est publié par le paquet nodefony (node_modules/nodefony/.ai/symbols.json) ;\n` +
        `  celui de l'application s'écrit par : nodefony symbols --generate\n`,
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
    if (
      !parsed.json &&
      sym.name !== parsed.name &&
      !parsed.name.includes(":")
    ) {
      // Trouvé par son nom PUBLIÉ : le dire, sinon la réponse semble parler
      // d'un autre symbole que celui demandé.
      process.stdout.write(
        `  publié sous : ${parsed.name} (export { ${sym.name} as ${parsed.name} })\n`,
      );
    }
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

/**
 * Porte de la ligne de commande : `--generate` écrit le graphe de
 * l'application, tout le reste le lit ({@link runSymbolsCommand}).
 *
 * @param argv - `process.argv` complet.
 * @returns exit code sémantique : `OK`, `USAGE`, `NOINPUT` hors application,
 *   `UNAVAILABLE` sans compilateur TypeScript, ceux de la lecture sinon.
 */
export async function runSymbolsCli(argv: string[]): Promise<number> {
  const parsed = parseSymbolsArgv(argv);
  if ("error" in parsed || parsed.help || !parsed.generate) {
    return runSymbolsCommand(argv);
  }
  const root = findProjectRoot(parsed.cwd);
  if (root === null) {
    process.stderr.write(
      `symbols: aucune application ici (pas de nodefony.config.ts en remontant depuis ${parsed.cwd}).\n`,
    );
    return SysExit.NOINPUT;
  }
  const outcome = await generateProjectSymbols(root);
  if (!outcome.ok) {
    process.stderr.write(`symbols: ${outcome.message}`);
    return outcome.code;
  }
  if (parsed.json) {
    process.stdout.write(`${JSON.stringify(outcome, null, 2)}\n`);
    return SysExit.OK;
  }
  process.stdout.write(
    `graphe écrit : ${path.relative(parsed.cwd, outcome.file) || outcome.file}\n` +
      `${outcome.files} fichier(s) lus, ${outcome.exported} symbole(s) exporté(s)\n\n`,
  );
  for (const [mod, n] of Object.entries(outcome.modules).sort(
    (a, b) => b[1] - a[1],
  )) {
    process.stdout.write(`  ${String(n).padStart(5)}  ${mod}\n`);
  }
  for (const s of outcome.skipped) {
    process.stdout.write(
      `  ⚠ écarté (${Math.round(s.bytes / 1024)} Ko, trop gros) : ${s.file}\n`,
    );
  }
  return SysExit.OK;
}
