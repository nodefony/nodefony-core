import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { findProjectRoot, resolveSymbolsFile } from "nodefony";

const execFileAsync = promisify(execFile);

/**
 * Racine de l'APPLICATION servie — jamais le dossier courant du process.
 *
 * Tout ce que ce module lit hors des modules eux-mêmes (`.ai/symbols.json`, les
 * `node_modules` hissés, les docs du core, le dépôt git) vit à la racine de
 * l'application. Or `process.cwd()` est le dossier depuis lequel quelqu'un a
 * TAPÉ la commande : lancer l'application depuis un sous-dossier suffisait à
 * vider les onglets Docs et API du plan d'administration, sans erreur ni trace
 * — un fichier absent est indistinguable d'un module sans documentation.
 *
 * On remonte donc au premier dossier portant `nodefony.config.ts`, avec la même
 * définition de « où commence l'app » que le lanceur, les scaffolds et
 * `nodefony check`. Hors projet (dépôt de paquets, test), le dossier courant
 * reste le repli.
 */
function appRoot(): string {
  return findProjectRoot(process.cwd()) ?? process.cwd();
}

/**
 * Frontmatter d'un fichier de doc module. Tous les champs sont optionnels —
 * un `.md` sans frontmatter reste lisible (titre dérivé du premier `# H1`).
 *
 * On accepte les alias historiques (`last-updated` ⇄ `updated`, `topic` ⇄
 * `title`) pour ne pas réécrire les docs `architecture/*` déjà frontmattées.
 */
export interface DocFrontmatter {
  title?: string;
  navTitle?: string;
  module?: string;
  since?: string;
  updated?: string;
  status?: string;
  order?: number;
  [key: string]: unknown;
}

/** Entrée du sommaire docs d'un module (sans le corps markdown). */
export interface DocSummary {
  /** Identifiant url-safe = nom de fichier sans extension. */
  slug: string;
  /** Titre humain (frontmatter `title`/`topic`, sinon premier H1, sinon slug). */
  title: string;
  /**
   * Libellé COURT du menu (frontmatter `navTitle`), repli sur {@link title}. Un
   * titre est écrit pour être lu en tête d'article ; une colonne de navigation
   * n'a pas la même largeur, et une recherche doit trouver le mot AFFICHÉ.
   */
  navTitle: string;
  /** `draft` | `stable` | `deprecated` | `null`. */
  status: string | null;
  since: string | null;
  /** `updated`/`last-updated` du frontmatter. */
  updated: string | null;
  /** Date ISO du dernier commit git du fichier (dérive doc↔code). `null` hors git. */
  gitUpdated: string | null;
  /** Ordre d'affichage croissant (frontmatter `order`, défaut 100, `index`=0). */
  order: number;
}

/** Doc complète : frontmatter + corps markdown (frontmatter retiré). */
export interface DocContent {
  slug: string;
  frontmatter: DocFrontmatter;
  markdown: string;
  gitUpdated: string | null;
}

/** Symbole TS exporté d'un module, projeté depuis `.ai/symbols.json`. */
export interface ModuleSymbol {
  name: string;
  kind: string;
  file: string;
  description: string | null;
  extends: string | null;
  implements: string[];
  decorators: string[];
}

/** Slug url-safe — borne le path traversal sur `module/{name}/docs/{slug}`. */
const SLUG_RE = /^[a-z0-9][a-z0-9._-]*$/i;

/**
 * Parse un bloc frontmatter YAML minimaliste (clé: valeur scalaires).
 *
 * Volontairement sans dépendance (`gray-matter` etc.) : on ne gère que des
 * scalaires `key: value` entre deux `---`. Les listes inline (`[a, b]`) sont
 * conservées en string brute. Suffisant pour `title/module/status/since/
 * updated/order`. Renvoie `{ data, body }` ; sans fence → `data` vide.
 */
export function parseFrontmatter(raw: string): {
  data: DocFrontmatter;
  body: string;
} {
  if (!raw.startsWith("---")) return { data: {}, body: raw };
  // Fin du bloc : première ligne `---` après l'ouverture.
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { data: {}, body: raw };
  const block = raw.slice(3, end);
  const after = raw.slice(end + 4);
  const body = after.startsWith("\n") ? after.slice(1) : after;
  const data: DocFrontmatter = {};
  for (const line of block.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colon = trimmed.indexOf(":");
    if (colon === -1) continue;
    const key = trimmed.slice(0, colon).trim();
    let value = trimmed.slice(colon + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key === "order") {
      const n = Number(value);
      data.order = Number.isFinite(n) ? n : undefined;
    } else if (key === "last-updated" && data.updated === undefined) {
      data.updated = value;
    } else {
      data[key] = value;
    }
  }
  return { data, body };
}

/** Premier titre `# H1` du corps markdown, ou `null`. */
function firstHeading(body: string): string | null {
  const m = body.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

/**
 * Date ISO du dernier commit git d'un fichier (détecte la dérive doc↔code).
 *
 * Fallback sur le `mtime` fs si le fichier n'est pas suivi par git ou hors
 * dépôt. Endpoint admin (basse fréquence) → coût d'un `spawn` git acceptable.
 */
async function gitLastUpdated(file: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["log", "-1", "--format=%cI", "--", file],
      { cwd: appRoot() },
    );
    const iso = stdout.trim();
    if (iso) return iso;
  } catch {
    /* hors git — fallback mtime */
  }
  try {
    const st = await stat(file);
    return st.mtime.toISOString();
  } catch {
    return null;
  }
}

/** Construit un `DocSummary` à partir du contenu brut d'un `.md`. */
async function summarize(
  docsDir: string,
  fileName: string,
  withGit: boolean,
): Promise<DocSummary> {
  const slug = basename(fileName, extname(fileName));
  const full = join(docsDir, fileName);
  const raw = await readFile(full, "utf8");
  const { data, body } = parseFrontmatter(raw);
  const title = docTitle(data, body, slug);
  return {
    slug,
    title,
    navTitle:
      typeof data.navTitle === "string" && data.navTitle.trim()
        ? data.navTitle.trim()
        : title,
    status: typeof data.status === "string" ? data.status : null,
    since: typeof data.since === "string" ? data.since : null,
    updated: typeof data.updated === "string" ? data.updated : null,
    // Git par doc = 1 spawn → coûteux × N. Skippé dans la LISTE (gitUpdated réel
    // calculé à l'ouverture par `readModuleDoc`). Cf perf endpoint module detail.
    gitUpdated: withGit ? await gitLastUpdated(full) : null,
    order:
      typeof data.order === "number" ? data.order : slug === "index" ? 0 : 100,
  };
}

/**
 * Sommaire des docs d'un module : lit les `*.md` de `<modulePath>/docs/`
 * (un niveau, non récursif), parse le frontmatter, trie par `order` puis slug.
 *
 * @param modulePath - chemin disque du module (`Module.path`).
 * @returns liste triée (vide si le dossier `docs/` est absent).
 */
export async function listModuleDocs(
  modulePath: string,
  withGit = false,
): Promise<DocSummary[]> {
  const docsDir = join(modulePath, "docs");
  let entries: string[];
  try {
    entries = await readdir(docsDir);
  } catch {
    return [];
  }
  const mdFiles = entries.filter((f) => f.toLowerCase().endsWith(".md"));
  const summaries = await Promise.all(
    mdFiles.map((f) => summarize(docsDir, f, withGit)),
  );
  return summaries.sort(
    (a, b) => a.order - b.order || a.slug.localeCompare(b.slug),
  );
}

/**
 * Comptage rapide des docs (`*.md`) d'un module — readdir seul, sans lire/parser
 * ni `git`. Pour les KPI/overview (`docsCount`) où seul le nombre importe.
 *
 * @param modulePath - chemin disque du module (`Module.path`).
 * @returns nombre de fichiers `.md` dans `<modulePath>/docs/` (0 si absent).
 */
export async function countModuleDocs(modulePath: string): Promise<number> {
  try {
    const entries = await readdir(join(modulePath, "docs"));
    return entries.filter((f) => f.toLowerCase().endsWith(".md")).length;
  } catch {
    return 0;
  }
}

/**
 * Lit une doc module par slug : frontmatter + corps markdown brut.
 *
 * Le slug est borné (`SLUG_RE`) avant toute jointure de chemin → pas de path
 * traversal vers l'extérieur de `<modulePath>/docs/`.
 *
 * @returns `null` si slug invalide ou fichier absent.
 */
export async function readModuleDoc(
  modulePath: string,
  slug: string,
): Promise<DocContent | null> {
  if (!SLUG_RE.test(slug)) return null;
  const full = join(modulePath, "docs", `${slug}.md`);
  let raw: string;
  try {
    raw = await readFile(full, "utf8");
  } catch {
    return null;
  }
  const { data, body } = parseFrontmatter(raw);
  return {
    slug,
    frontmatter: data,
    markdown: body,
    gitUpdated: await gitLastUpdated(full),
  };
}

/**
 * Titre humain d'une doc — frontmatter, sinon premier `# H1`, sinon le slug.
 *
 * Partagé par le sommaire et la recherche : deux lectures du même fichier qui
 * n'en tireraient pas le même titre feraient croire à deux documents.
 */
function docTitle(data: DocFrontmatter, body: string, slug: string): string {
  return (
    data.title ??
    firstHeading(body) ??
    (typeof data.topic === "string" ? data.topic : null) ??
    slug
  );
}

/** Où un terme cherché apparaît, et la ligne qui le porte. */
export interface DocSearchMatch {
  /** Ligne (1-indexée) dans le CORPS markdown, frontmatter retiré. */
  line: number;
  /** La ligne, ramenée à une fenêtre lisible autour du terme. */
  text: string;
}

/** Une doc qui répond à la recherche, avec ses extraits. */
export interface DocSearchHit {
  /** Clé du module qui porte la doc (`http`, `security`, `core`…). */
  module: string;
  slug: string;
  title: string;
  /** Extraits, dans l'ordre du document — bornés (cf `perDoc`). */
  matches: DocSearchMatch[];
  /** Occurrences TOTALES dans la doc ; les extraits, eux, sont bornés. */
  occurrences: number;
  /** Pertinence décroissante — un titre ou un slug porteur du terme pèse. */
  score: number;
}

/** Une doc à balayer : la clé du module qui la porte, et son chemin disque. */
export interface DocSearchTarget {
  /** Clé d'affichage du module (`http`, `security`, `core`…). */
  key: string;
  /** Chemin disque du module (`Module.path`). */
  path: string;
}

/** Ce que rend une recherche : les docs retenues, et ce qu'elle a balayé. */
export interface DocSearchResult {
  /** Termes effectivement cherchés, après normalisation. */
  terms: string[];
  /** Docs balayées — dit à l'agent si le corpus était bien là. */
  scanned: number;
  /** Docs qui portent TOUS les termes — avant la borne d'affichage. */
  matched: number;
  /** Les meilleures, bornées par `limit`. */
  hits: DocSearchHit[];
  /**
   * Phrase d'annonce, présente UNIQUEMENT quand la borne a joué.
   *
   * ⚠️ `matched` seul ne suffit pas à s'en apercevoir : quand le nombre de
   * documents trouvés égale la borne — le cas exact d'un corpus fourni — un
   * lecteur voit « 20 » des deux côtés et conclut qu'il tient tout. Il faut
   * donc le DIRE, et nommer le geste qui donne la suite. Absente quand tout
   * est rendu : annoncer une coupe qui n'a pas eu lieu ferait chercher un
   * reste inexistant.
   */
  note?: string;
}

/** Docs rendues par défaut — au-delà, l'agent relit au lieu de décider. */
const SEARCH_MAX_DOCS = 20;
/** Extraits gardés par doc. */
const SEARCH_MAX_PER_DOC = 3;
/** Largeur d'un extrait : une ligne de markdown peut faire un paragraphe. */
const SNIPPET_MAX_CHARS = 240;
/** Ce que pèse un terme trouvé dans le titre ou le slug, en occurrences. */
const TITLE_WEIGHT = 5;

/**
 * Longueur d'une page de référence, en caractères — le pivot de la DENSITÉ.
 *
 * ⚠️ Compter les occurrences BRUTES classe par la taille, pas par la
 * pertinence : un tableau de bord de plusieurs dizaines de milliers de
 * caractères mentionne tout, donc il gagne toutes les recherches — et sortait
 * devant la page qui TRAITE le sujet demandé. Ce qui distingue un document
 * pertinent d'un document long, c'est la densité du terme, pas son total.
 *
 * Un document plus court que ce pivot n'est jamais AVANTAGÉ (le diviseur est
 * planché à 1) : on corrige le biais du volume, on n'en crée pas l'inverse.
 */
const DOC_LENGTH_PIVOT = 8_000;

/**
 * Forme comparable d'un texte : minuscules, sans diacritiques.
 *
 * Un agent tape `securite` et la doc écrit « sécurité » — sans repli, la
 * recherche rend zéro résultat sur un corpus qui traite le sujet en quinze
 * pages, et rien ne dit que c'est l'accent qui a manqué.
 */
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Fenêtre lisible autour de la première occurrence d'un terme dans une ligne.
 *
 * Une ligne de markdown n'est pas une ligne d'écran : un paragraphe entier peut
 * tenir sur une seule, et le rendre en entier fait de la recherche un second
 * déversement du corpus.
 */
function snippet(line: string, folded: string, term: string): string {
  if (line.length <= SNIPPET_MAX_CHARS) return line.trim();
  const at = folded.indexOf(term);
  const start = Math.max(0, at - Math.floor(SNIPPET_MAX_CHARS / 3));
  const end = Math.min(line.length, start + SNIPPET_MAX_CHARS);
  return (
    (start > 0 ? "…" : "") +
    line.slice(start, end).trim() +
    (end < line.length ? "…" : "")
  );
}

/**
 * Cherche un texte dans les docs colocalisées des modules donnés.
 *
 * ⭐ **Pourquoi cette fonction existe** : chez un utilisateur, la documentation
 * des modules vit sous `node_modules/@nodefony/<mod>/docs/` — un dossier que `git`
 * ignore, donc que `rg` et les outils de recherche des agents EXCLUENT par
 * défaut. La doc est livrée et introuvable ; c'est cette porte qui la rend
 * atteignable, sans quoi l'agent réécrit à la main ce qui est déjà écrit.
 *
 * Un document est retenu s'il porte **TOUS** les termes (et non l'un d'eux) :
 * sur un corpus où « session » apparaît partout, un OU rendrait le corpus.
 * La comparaison est faite sans casse ni diacritiques ({@link fold}).
 *
 * Aucun index n'est conservé : le corpus est relu à chaque appel. C'est une
 * opération de développement, rare et explicite — un index en mémoire coûterait
 * en permanence ce qu'il ferait gagner quelques fois, et se périmerait à la
 * première doc éditée.
 *
 * @param targets - modules à balayer (clé + chemin disque)
 * @param query - texte cherché ; les espaces séparent des termes cumulatifs
 * @param options - bornes de rendu (`limit` docs, `perDoc` extraits)
 * @returns les docs retenues, et ce que la recherche a réellement balayé
 */
export async function searchModuleDocs(
  targets: readonly DocSearchTarget[],
  query: string,
  options: { limit?: number; perDoc?: number } = {},
): Promise<DocSearchResult> {
  const terms = fold(query)
    .split(/\s+/)
    .filter((t) => t.length > 0);
  const limit = options.limit ?? SEARCH_MAX_DOCS;
  const perDoc = options.perDoc ?? SEARCH_MAX_PER_DOC;
  if (terms.length === 0) {
    return { terms, scanned: 0, matched: 0, hits: [] };
  }

  const hits: DocSearchHit[] = [];
  let scanned = 0;

  for (const target of targets) {
    const docsDir = join(target.path, "docs");
    let entries: string[];
    try {
      entries = await readdir(docsDir);
    } catch {
      continue;
    }
    for (const fileName of entries) {
      if (!fileName.toLowerCase().endsWith(".md")) continue;
      let raw: string;
      try {
        raw = await readFile(join(docsDir, fileName), "utf8");
      } catch {
        continue;
      }
      scanned += 1;
      const slug = basename(fileName, extname(fileName));
      const { data, body } = parseFrontmatter(raw);
      const title = docTitle(data, body, slug);
      // Le libellé de menu entre dans l'index : c'est le mot que le lecteur VOIT,
      // donc celui qu'il tape. Sans lui, chercher « Tests » ne trouve pas la page
      // dont le menu affiche « Tests » mais dont le titre dit autre chose.
      const navTitle =
        typeof data.navTitle === "string" && data.navTitle.trim()
          ? data.navTitle.trim()
          : "";
      const foldedTitle = fold(`${title} ${navTitle} ${slug}`);
      const lines = body.split("\n");
      const foldedLines = lines.map(fold);

      // Un document ne compte que s'il porte TOUS les termes — vérifié sur le
      // corps ET sur son titre, sinon une page intitulée « Sessions » sortirait
      // des résultats d'une recherche « sessions redis » qu'elle mérite.
      const foldedBody = fold(body);
      const carries = terms.every(
        (term) => foldedBody.includes(term) || foldedTitle.includes(term),
      );
      if (!carries) continue;

      let occurrences = 0;
      let score = 0;
      for (const term of terms) {
        let at = foldedBody.indexOf(term);
        while (at !== -1) {
          occurrences += 1;
          at = foldedBody.indexOf(term, at + term.length);
        }
        if (foldedTitle.includes(term)) score += TITLE_WEIGHT;
      }
      // Densité plutôt que total : occurrences ramenées à la taille du
      // document, le titre gardant son poids propre (il dit le SUJET, quelle
      // que soit la longueur).
      score += occurrences / Math.max(1, foldedBody.length / DOC_LENGTH_PIVOT);

      // ⚠️ Les extraits se choisissent sur la COUVERTURE, pas sur l'ordre du
      // document. Prendre les premières lignes portant AU MOINS un terme
      // donnait, sur « session redis », trois extraits qui ne parlaient que de
      // sessions : la page était la bonne, ses extraits ne le montraient pas,
      // et un lecteur qui juge sur les extraits passait son chemin. Une ligne
      // qui porte les DEUX termes vaut mieux que trois qui n'en portent qu'un.
      const candidats: { ligne: number; couverture: number; terme: string }[] =
        [];
      for (let i = 0; i < lines.length; i += 1) {
        const portes = terms.filter((t) => foldedLines[i].includes(t));
        if (portes.length === 0) continue;
        candidats.push({
          ligne: i,
          couverture: portes.length,
          terme: portes[0],
        });
      }
      candidats.sort(
        (a, b) => b.couverture - a.couverture || a.ligne - b.ligne,
      );
      const matches: DocSearchMatch[] = candidats
        .slice(0, perDoc)
        // Remis dans l'ordre du document : trois extraits qui remontent le
        // texte à rebours se lisent mal, et rien ne le justifie.
        .sort((a, b) => a.ligne - b.ligne)
        .map((c) => ({
          line: c.ligne + 1,
          text: snippet(lines[c.ligne], foldedLines[c.ligne], c.terme),
        }));

      hits.push({
        module: target.key,
        slug,
        title,
        matches,
        occurrences,
        score,
      });
    }
  }

  hits.sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug));
  const rendus = hits.slice(0, limit);
  return {
    terms,
    scanned,
    matched: hits.length,
    hits: rendus,
    ...(hits.length > rendus.length
      ? {
          // ⚠️ Dire la borne EFFECTIVE, jamais « par défaut » : la borne peut
          // avoir été DEMANDÉE par l'appelant, et lui présenter son propre
          // choix comme un défaut du produit l'envoie chercher un réglage
          // ailleurs. Une phrase d'aide qui se trompe coûte plus qu'une absence
          // de phrase.
          note: `${hits.length} documents portent ces termes, ${rendus.length} sont rendus (borne « limit » = ${limit}). Précise les termes, ou rappelle avec limit plus grand.`,
        }
      : {}),
  };
}
/** Forme minimale d'une entrée `.ai/symbols.json` (lecture défensive). */
interface RawSymbol {
  name?: string;
  kind?: string;
  file?: string;
  module?: string;
  exported?: boolean;
  description?: string;
  extends?: string | null;
  implements?: string[];
  decorators?: string[];
}

/**
 * Symboles TS exportés d'un module + descriptions TSDoc, lus depuis
 * `.ai/symbols.json` (à la racine de l'application, cf {@link appRoot}).
 *
 * 100 % auto-généré (jamais de `.d.ts` manuel) → zéro divergence avec le code.
 * Tab API maigre tant que la couverture TSDoc est faible : c'est volontaire,
 * ça pousse à documenter.
 *
 * @param packageName - nom npm du module (`Module.getModuleName()`, ex
 *   `"@nodefony/http"`) — clé `.module` dans le graphe symbolique.
 * @returns symboles exportés triés par kind puis nom (vide si fichier absent).
 */
export async function listModuleSymbols(
  packageName: string,
): Promise<ModuleSymbol[]> {
  // Le graphe se RÉSOUT (projet, puis framework installé) — il ne se compose
  // pas ici : un chemin en dur était précisément ce qui le rendait introuvable
  // dans une application installée depuis npm, où il vit sous
  // `node_modules/nodefony/.ai/`. Résolution partagée avec `nodefony symbols`.
  const file = resolveSymbolsFile(process.cwd());
  if (file === null) return [];
  let parsed: { symbols?: Record<string, RawSymbol> };
  try {
    parsed = JSON.parse(await readFile(file, "utf8"));
  } catch {
    return [];
  }
  const symbols = parsed.symbols ?? {};
  const out: ModuleSymbol[] = [];
  for (const sym of Object.values(symbols)) {
    if (sym.module !== packageName || sym.exported !== true) continue;
    out.push({
      name: sym.name ?? "",
      kind: sym.kind ?? "unknown",
      file: sym.file ?? "",
      description: typeof sym.description === "string" ? sym.description : null,
      extends: sym.extends ?? null,
      implements: Array.isArray(sym.implements) ? sym.implements : [],
      decorators: Array.isArray(sym.decorators) ? sym.decorators : [],
    });
  }
  return out.sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name),
  );
}

/** Ce qu'on a trouvé d'un symbole dans les types LIVRÉS d'un module. */
export interface SymbolDeclaration {
  /**
   * Fichier de TYPES qui porte la déclaration, relatif au module — jamais
   * absolu (une réponse ne publie pas l'arborescence du serveur).
   *
   * Nommé `declarationFile` et non `file` : le graphe symbolique porte DÉJÀ un
   * `file`, qui désigne la SOURCE dans le dépôt d'origine — un chemin qui
   * n'existe pas chez celui qui a installé le paquet. Deux notions sous un même
   * nom, et la fusion des deux réponses en écrasait une.
   */
  declarationFile: string;
  /** Le bloc de déclaration, TSDoc compris. */
  declaration: string;
  /** Le bloc a-t-il été coupé ? Une troncature muette vaut un mensonge. */
  truncated: boolean;
}

/** Au-delà, une déclaration cesse d'informer et se met à remplir. */
const DECLARATION_MAX_CHARS = 12_000;
/** Garde-fou de balayage : un `dist/types` sain tient en quelques dizaines. */
const DECLARATION_MAX_FILES = 400;

/**
 * Fichiers de types d'un module, du plus probable au moins probable.
 *
 * `dist/types/` est ce qu'un utilisateur REÇOIT ; les sources `.ts` ne sont là
 * que dans ce dépôt, où quelques paquets pointent leurs types vers leur
 * `index.ts` (anti-race de build). On regarde donc les deux, dans cet ordre —
 * mais on ne descend jamais dans `node_modules`, dont les types appartiennent à
 * d'autres.
 */
async function typeFiles(modulePath: string): Promise<string[]> {
  const found: string[] = [];
  for (const sub of ["dist/types", "nodefony", "src"]) {
    let entries: string[];
    try {
      entries = await readdir(join(modulePath, sub), { recursive: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.includes("node_modules")) continue;
      if (!entry.endsWith(".d.ts") && !entry.endsWith(".ts")) continue;
      if (entry.endsWith(".test.ts")) continue;
      found.push(join(sub, entry));
      if (found.length >= DECLARATION_MAX_FILES) return found;
    }
  }
  return found;
}

/**
 * Où commence la déclaration d'un symbole — avec le TSDoc qui la précède.
 *
 * Le commentaire n'est pas un ornement : c'est là que vit le POURQUOI, et il
 * traverse le build (`.d.ts`) là où un `//` inline disparaît. Le rendre avec la
 * signature est ce qui distingue « voici les paramètres » de « voici ce qu'en
 * faire ».
 */
function declarationStart(lines: readonly string[], at: number): number {
  let start = at;
  // Le bloc TSDoc est juste au-dessus : on remonte tant qu'on est dedans.
  if (start > 0 && lines[start - 1].trim().endsWith("*/")) {
    let i = start - 1;
    while (i > 0 && !lines[i].trim().startsWith("/**")) i -= 1;
    if (lines[i].trim().startsWith("/**")) start = i;
  }
  return start;
}

/**
 * Extrait la déclaration d'un symbole des types LIVRÉS d'un module.
 *
 * ⭐ **Pourquoi cette fonction existe** : le graphe symbolique
 * (`.ai/symbols.json`) dit qu'un symbole existe, ce qu'il étend et la première
 * phrase de sa documentation — mais **pas sa signature**. À « quels arguments
 * prend cette méthode ? », un agent n'a donc aucune réponse : les `.d.ts` qui
 * la portent vivent sous `node_modules`, que git ignore et que les outils de
 * recherche de fichiers excluent. Il devine, et il devine faux.
 *
 * Le nom demandé ne touche JAMAIS un chemin : il sert à filtrer du texte. Les
 * fichiers balayés sont dérivés du module, pas de l'appelant — un paramètre qui
 * entrerait dans un `join` serait une traversée de répertoire offerte.
 *
 * @param modulePath - chemin disque du module (`Module.path`)
 * @param symbolName - nom exact du symbole (`AbstractCrudService`, `IKernel`)
 * @returns la déclaration et son fichier, ou `null` si rien ne la porte
 */
export async function readSymbolDeclaration(
  modulePath: string,
  symbolName: string,
): Promise<SymbolDeclaration | null> {
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(symbolName)) return null;
  const declare = new RegExp(
    String.raw`^\s*(?:export\s+)?(?:declare\s+)?(?:abstract\s+)?` +
      String.raw`(?:class|interface|function|const|let|var|type|enum|namespace)\s+` +
      symbolName +
      String.raw`\b`,
  );

  for (const relative of await typeFiles(modulePath)) {
    let raw: string;
    try {
      raw = await readFile(join(modulePath, relative), "utf8");
    } catch {
      continue;
    }
    // Un `indexOf` avant la découpe en lignes : sur des dizaines de fichiers,
    // c'est ce qui évite de payer un `split` pour rien.
    if (!raw.includes(symbolName)) continue;
    const lines = raw.split("\n");
    const at = lines.findIndex((line) => declare.test(line));
    if (at === -1) continue;

    const start = declarationStart(lines, at);
    // Fin du bloc : on suit les accolades depuis la ligne de déclaration. Une
    // déclaration sans accolade (`type X = …`) tient sur sa ligne logique,
    // terminée par un `;`.
    let depth = 0;
    let opened = false;
    let end = at;
    for (let i = at; i < lines.length; i += 1) {
      for (const ch of lines[i]) {
        if (ch === "{") {
          depth += 1;
          opened = true;
        } else if (ch === "}") depth -= 1;
      }
      end = i;
      if (opened && depth <= 0) break;
      if (!opened && lines[i].trimEnd().endsWith(";")) break;
    }

    const declaration = lines.slice(start, end + 1).join("\n");
    return declaration.length > DECLARATION_MAX_CHARS
      ? {
          declarationFile: relative,
          declaration: declaration.slice(0, DECLARATION_MAX_CHARS),
          truncated: true,
        }
      : { declarationFile: relative, declaration, truncated: false };
  }
  return null;
}

/**
 * Identité du package npm du core (`@nodefony/core`) tel qu'indexé dans
 * `.ai/symbols.json` — le core est référencé sous ce nom logique, **pas** sous
 * son nom npm réel (`nodefony`, héritage JS).
 */
export const CORE_PACKAGE = "@nodefony/core";

/** Dépendance d'un module : range déclarée + version installée. */
export interface DepInfo {
  name: string;
  kind: "nodefony" | "external";
  range: string | null;
  installed: string | null;
}

/** Statut "outdated" d'une dep externe (registry npm). */
export interface OutdatedInfo {
  name: string;
  installed: string | null;
  latest: string | null;
  outdated: boolean;
}

/**
 * Dépendances d'un module : depuis son `package.json` (dependencies +
 * peerDependencies) avec la version RÉELLEMENT installée (lue dans
 * `node_modules/<dep>/package.json`, local puis hoisté à la racine).
 */
export async function readDependencies(modulePath: string): Promise<DepInfo[]> {
  let pkg: {
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  } = {};
  try {
    pkg = JSON.parse(await readFile(join(modulePath, "package.json"), "utf8"));
  } catch {
    /* pas de package.json */
  }
  const ranges: Record<string, string> = {
    ...pkg.dependencies,
    ...pkg.peerDependencies,
  };
  const root = appRoot();
  const out: DepInfo[] = [];
  for (const name of Object.keys(ranges).sort()) {
    const kind: DepInfo["kind"] =
      name === "nodefony" || name.startsWith("@nodefony/")
        ? "nodefony"
        : "external";
    let installed: string | null = null;
    for (const base of [modulePath, root]) {
      try {
        const dp = JSON.parse(
          await readFile(
            join(base, "node_modules", name, "package.json"),
            "utf8",
          ),
        );
        if (typeof dp.version === "string") {
          installed = dp.version;
          break;
        }
      } catch {
        /* dep absente à cet emplacement */
      }
    }
    out.push({ name, kind, range: ranges[name] ?? null, installed });
  }
  return out;
}

/** Compare deux versions semver (a > b ?) — major.minor.patch numérique. */
function semverGt(a: string, b: string): boolean {
  const p = (s: string) =>
    s
      .replace(/^[^\d]*/, "")
      .split(".")
      .map((n) => parseInt(n, 10) || 0);
  const pa = p(a);
  const pb = p(b);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

/**
 * Vérifie les MAJ des deps EXTERNES via le registry npm (`/<pkg>/latest`).
 * Les deps Nodefony (workspaces locaux) sont ignorées. Réseau → on-demand.
 */
export async function checkOutdated(deps: DepInfo[]): Promise<OutdatedInfo[]> {
  const external = deps.filter((d) => d.kind === "external");
  return Promise.all(
    external.map(async (d) => {
      let latest: string | null = null;
      try {
        // `encodeURIComponent`, pas `replace("/", "%2F")` : la seconde forme ne
        // remplace que la PREMIÈRE occurrence et laisse passer tout le reste
        // (`..`, `?`, `#`) dans une URL. Le nom vient d'un `package.json` lu sur
        // le disque — la confiance qu'on lui accorde n'a pas à être implicite.
        // Vérifié au registre : la forme entièrement encodée (`%40scope%2Fnom`)
        // répond comme l'ancienne.
        const url = `https://registry.npmjs.org/${encodeURIComponent(d.name)}/latest`;
        const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (r.ok) {
          const j = (await r.json()) as { version?: unknown };
          if (typeof j.version === "string") latest = j.version;
        }
      } catch {
        /* registry indispo / timeout */
      }
      return {
        name: d.name,
        installed: d.installed,
        latest,
        outdated: Boolean(
          latest && d.installed && semverGt(latest, d.installed),
        ),
      };
    }),
  );
}

/** Résultat d'un lancement de tests (un fichier ou toute la suite). */
export interface TestRunResult {
  ok: boolean;
  code: number | null;
  passed: number;
  failed: number;
  durationMs: number;
  output: string;
  mode: string;
}

/** Walk `*.test.ts` (hors node_modules/dist/.coverage) → chemins relatifs triés. */
async function collectTestFiles(modulePath: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 8) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (
        e.name === "node_modules" ||
        e.name === "dist" ||
        e.name === ".coverage"
      )
        continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) await walk(full, depth + 1);
      else if (e.isFile() && e.name.endsWith(".test.ts"))
        out.push(rel(full, modulePath));
    }
  };
  await walk(modulePath, 0);
  out.sort();
  return out;
}

/** Est-ce un test unit ? (seul lançable par `vitest run <file>` sans serveur). */
function isUnitTest(relPath: string): boolean {
  return relPath.includes("/unit/") || relPath.includes("tests/unit/");
}

/** Catégorie d'un fichier de test, dérivée de son chemin/nom (dossier de suite). */
function testCategory(relPath: string): string {
  if (isUnitTest(relPath)) return "unit";
  if (relPath.includes("/integration/")) return "integration";
  if (relPath.includes("/e2e/") || relPath.endsWith(".e2e.test.ts"))
    return "e2e";
  if (relPath.includes("/load/")) return "load";
  if (relPath.includes("/websockets/")) return "websockets";
  if (relPath.includes("/routing/")) return "routing";
  if (relPath.endsWith("memory.test.ts")) return "memory";
  return "autre";
}

/**
 * Liste les fichiers de test **unit** d'un module (lançables par `vitest run`).
 * Si aucune suite unit, repli sur tous les fichiers. Chemins relatifs au module.
 */
export async function listTestFiles(modulePath: string): Promise<string[]> {
  const all = await collectTestFiles(modulePath);
  const unit = all.filter(isUnitTest);
  return unit.length ? unit : all;
}

/** Un groupe de suites de tests (pour l'onglet Tests de Studio). */
export interface TestGroup {
  /** Catégorie (`unit`/`integration`/`e2e`/`load`/`websockets`/`routing`/`memory`/`autre`). */
  category: string;
  files: string[];
  /** Lançable depuis Studio ? (unit seulement — les autres tapent un serveur/DB). */
  runnable: boolean;
}

const TEST_CATEGORY_ORDER = [
  "unit",
  "integration",
  "e2e",
  "websockets",
  "routing",
  "load",
  "memory",
  "autre",
];

/**
 * Groupe TOUS les fichiers de test d'un module par catégorie (lecture seule pour
 * l'onglet Tests — les non-unit ne sont pas lançables depuis Studio : ils exigent
 * un serveur live / une base, donc `runnable:false`). Donne une vue complète des
 * suites (intégration/e2e/charge/mémoire) qui étaient invisibles auparavant.
 */
export async function listTestGroups(modulePath: string): Promise<TestGroup[]> {
  const all = await collectTestFiles(modulePath);
  const byCat = new Map<string, string[]>();
  for (const f of all) {
    const c = testCategory(f);
    let arr = byCat.get(c);
    if (arr === undefined) {
      arr = [];
      byCat.set(c, arr);
    }
    arr.push(f);
  }
  return [...byCat.entries()]
    .sort(
      ([a], [b]) =>
        TEST_CATEGORY_ORDER.indexOf(a) - TEST_CATEGORY_ORDER.indexOf(b),
    )
    .map(([category, files]) => ({
      category,
      files,
      runnable: category === "unit",
    }));
}

/** Commande exacte que `runModuleTests` lance — pure, testable sans process. */
export interface TestRunCommand {
  cmd: string;
  args: string[];
  mode: string;
}

/**
 * Compose la commande d'un run de tests de module, sans l'exécuter.
 *
 * - 1 fichier (module vitest) → `npx vitest run <file>` : le chemin est un
 *   FILTRE positionnel de vitest. Il ne doit JAMAIS suivre un `--` : vitest
 *   ignore tout ce qui vient après, et la suite ENTIÈRE tourne en silence
 *   (vécu : 18 fichiers joués pour un seul demandé, verdict « vert »). La
 *   défense anti-injection d'argument est la garde de l'appelant (pas de
 *   préfixe `-`, pas de `..`, suffixe `.test.ts` — cf KernelAdminApi).
 * - sinon (module vitest) → run-all, reporters coverage FORCÉS vers
 *   `.coverage` : l'onglet Coverage de Studio apparaît quelle que soit la
 *   config du module (la liste `reporter` dupliquée par module divergeait).
 * - sinon (cœur : monocart, pas de `vitest.config.ts`) → `npm run coverage`.
 *
 * @param modulePath - racine du module (où vit `vitest.config.ts`)
 * @param file - chemin relatif d'UN fichier de test, déjà validé par l'appelant
 * @returns commande, arguments en tableau (spawn sans shell) et libellé du mode
 */
export function testRunCommand(
  modulePath: string,
  file?: string,
): TestRunCommand {
  const hasVitest = existsSync(join(modulePath, "vitest.config.ts"));
  if (file && hasVitest) {
    return {
      cmd: "npx",
      args: ["vitest", "run", file],
      mode: `vitest run ${file}`,
    };
  }
  if (hasVitest) {
    return {
      cmd: "npx",
      args: [
        "vitest",
        "run",
        "--coverage",
        "--coverage.reporter=text-summary",
        "--coverage.reporter=json-summary",
        "--coverage.reporter=lcov",
        "--coverage.reportsDirectory=.coverage",
      ],
      mode: "vitest run --coverage (reporters forcés)",
    };
  }
  return {
    cmd: "npm",
    args: ["run", "coverage"],
    mode: "npm run coverage (suite complète)",
  };
}

/**
 * Lance les tests d'un module et renvoie un résumé (pass/fail/durée + tail).
 *
 * - 1 fichier (module vitest) → `npx vitest run <file>` (rapide, pass/fail).
 * - sinon → `npm run coverage` (suite complète + refresh coverage ; marche
 *   pour vitest comme pour monocart/core).
 *
 * ⚠️ EXÉCUTE un process — appelé UNIQUEMENT derrière le garde dev-only de
 * l'endpoint (cf KernelAdminApi). spawn sans shell + args en tableau (pas
 * d'injection shell). `file` validé en amont (suffixe .test.ts, pas de `..`).
 */
export function runModuleTests(
  modulePath: string,
  file?: string,
): Promise<TestRunResult> {
  const { cmd, args, mode } = testRunCommand(modulePath, file);
  const start = Date.now();
  return new Promise<TestRunResult>((resolve) => {
    let out = "";
    const cap = (d: Buffer) => {
      out += d.toString();
      if (out.length > 200_000) out = out.slice(-200_000);
    };
    let child;
    try {
      child = spawn(cmd, args, { cwd: modulePath, env: process.env });
    } catch (e) {
      return resolve({
        ok: false,
        code: null,
        passed: 0,
        failed: 0,
        durationMs: 0,
        output: String(e),
        mode,
      });
    }
    child.stdout?.on("data", cap);
    child.stderr?.on("data", cap);
    const timer = setTimeout(() => child.kill("SIGKILL"), 180_000);
    // Un spawn qui échoue émet `error` PUIS `close` : sans garde, le second
    // verdict écraserait le premier (silencieusement — une Promise ignore la
    // seconde résolution) et laisserait les listeners attachés.
    let settled = false;
    const settle = (result: TestRunResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout?.off("data", cap);
      child.stderr?.off("data", cap);
      // oxlint-disable-next-line no-multiple-resolved -- c'est ICI la garde `settled` décrite juste au-dessus : la règle signale sa propre correction, elle ne suit pas le drapeau
      resolve(result);
    };
    child.on("error", (e) => {
      settle({
        ok: false,
        code: null,
        passed: 0,
        failed: 0,
        durationMs: Date.now() - start,
        output: String(e),
        mode,
      });
    });
    child.on("close", (code) => {
      const clean = out.replace(/\x1b\[[0-9;]*m/g, "");
      const passed = Number(
        clean.match(/Tests\s+(\d+)\s+passed/)?.[1] ??
          clean.match(/(\d+)\s+passing/)?.[1] ??
          0,
      );
      const failed = Number(
        clean.match(/(\d+)\s+failed/)?.[1] ??
          clean.match(/(\d+)\s+failing/)?.[1] ??
          0,
      );
      settle({
        ok: code === 0,
        code,
        passed,
        failed,
        durationMs: Date.now() - start,
        output: clean.slice(-6000),
        mode,
      });
    });
  });
}

/**
 * Chemin disque racine du package core (`nodefony`).
 *
 * Le core n'est **pas** un module chargé (`kernel.getModules()` n'a pas de clé
 * `core`) : c'est le socle de tous les autres. On résout donc son emplacement
 * pour lire ses docs colocalisées (`<core>/docs/*.md`).
 *
 * Dev self-hosted : `<racine de l'app>/src/nodefony`. Fallback prod :
 * résolution du package npm `nodefony` (remontée jusqu'à son `package.json`).
 */
export function resolveCorePath(): string {
  const devPath = join(appRoot(), "src", "nodefony");
  if (existsSync(join(devPath, "package.json"))) return devPath;
  try {
    let dir = dirname(fileURLToPath(import.meta.resolve("nodefony")));
    for (let i = 0; i < 6; i++) {
      if (existsSync(join(dir, "package.json"))) return dir;
      dir = dirname(dir);
    }
  } catch {
    /* import.meta.resolve indispo → fallback dev */
  }
  return devPath;
}

/** Couverture d'un fichier (pourcentages, format json-summary istanbul/v8). */
export interface CoverageFile {
  file: string;
  lines: number;
  statements: number;
  functions: number;
  branches: number;
}

/** Rapport de couverture d'un module pour Studio (onglet Coverage). */
export interface CoverageReport {
  available: boolean;
  generated?: string | null;
  total?: {
    lines: number;
    statements: number;
    functions: number;
    branches: number;
  };
  files?: CoverageFile[];
}

const rel = (abs: string, modulePath: string) =>
  abs.startsWith(modulePath)
    ? abs.slice(modulePath.length).replace(/^\/+/, "")
    : abs;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Parse un `coverage-summary.json` (istanbul/vitest : total + par fichier). */
function parseSummary(
  json: Record<string, unknown>,
  modulePath: string,
): CoverageReport | null {
  const total = json.total as Record<string, { pct?: number }> | undefined;
  if (!total) return null;
  const pct = (m: { pct?: number } | undefined) =>
    typeof m?.pct === "number" ? m.pct : 0;
  const files: CoverageFile[] = [];
  for (const [abs, v] of Object.entries(json)) {
    if (abs === "total") continue;
    const m = v as Record<string, { pct?: number }>;
    files.push({
      file: rel(abs, modulePath),
      lines: pct(m.lines),
      statements: pct(m.statements),
      functions: pct(m.functions),
      branches: pct(m.branches),
    });
  }
  return {
    available: true,
    total: {
      lines: pct(total.lines),
      statements: pct(total.statements),
      functions: pct(total.functions),
      branches: pct(total.branches),
    },
    files,
  };
}

/** Parse un `lcov.info` (produit par monocart ET vitest) en {total, files}. */
function parseLcov(text: string, modulePath: string): CoverageReport | null {
  const files: CoverageFile[] = [];
  const tot = { lf: 0, lh: 0, fnf: 0, fnh: 0, brf: 0, brh: 0 };
  let cur: {
    p: string;
    lf: number;
    lh: number;
    fnf: number;
    fnh: number;
    brf: number;
    brh: number;
  } | null = null;
  const num = (s: string, i: number) => Number(s.slice(i)) || 0;
  const pctOf = (h: number, f: number) => (f > 0 ? round2((h / f) * 100) : 100);
  for (const line of text.split("\n")) {
    if (line.startsWith("SF:"))
      cur = {
        p: line.slice(3).trim(),
        lf: 0,
        lh: 0,
        fnf: 0,
        fnh: 0,
        brf: 0,
        brh: 0,
      };
    else if (!cur) continue;
    else if (line.startsWith("LF:")) cur.lf = num(line, 3);
    else if (line.startsWith("LH:")) cur.lh = num(line, 3);
    else if (line.startsWith("FNF:")) cur.fnf = num(line, 4);
    else if (line.startsWith("FNH:")) cur.fnh = num(line, 4);
    else if (line.startsWith("BRF:")) cur.brf = num(line, 4);
    else if (line.startsWith("BRH:")) cur.brh = num(line, 4);
    else if (line.startsWith("end_of_record")) {
      const ln = pctOf(cur.lh, cur.lf);
      files.push({
        file: rel(cur.p, modulePath),
        lines: ln,
        statements: ln,
        functions: pctOf(cur.fnh, cur.fnf),
        branches: pctOf(cur.brh, cur.brf),
      });
      tot.lf += cur.lf;
      tot.lh += cur.lh;
      tot.fnf += cur.fnf;
      tot.fnh += cur.fnh;
      tot.brf += cur.brf;
      tot.brh += cur.brh;
      cur = null;
    }
  }
  if (!files.length) return null;
  const ln = pctOf(tot.lh, tot.lf);
  return {
    available: true,
    total: {
      lines: ln,
      statements: ln,
      functions: pctOf(tot.fnh, tot.fnf),
      branches: pctOf(tot.brh, tot.brf),
    },
    files,
  };
}

/**
 * Lit le dernier rapport de couverture d'un module dans `<module>/.coverage/`.
 * Préfère `coverage-summary.json` (vitest, a les statements) ; sinon parse
 * `lcov.info` (produit par monocart côté core ET par vitest). Studio AFFICHE ce
 * rapport — il ne lance pas les tests. `available:false` si rien de généré.
 */
export async function readCoverage(
  modulePath: string,
): Promise<CoverageReport> {
  const dir = join(modulePath, ".coverage");
  let report: CoverageReport | null = null;
  let usedFile: string | null = null;
  const summaryPath = join(dir, "coverage-summary.json");
  try {
    report = parseSummary(
      JSON.parse(await readFile(summaryPath, "utf8")),
      modulePath,
    );
    if (report) usedFile = summaryPath;
  } catch {
    /* pas de summary → tenter lcov */
  }
  if (!report) {
    const lcovPath = join(dir, "lcov.info");
    try {
      report = parseLcov(await readFile(lcovPath, "utf8"), modulePath);
      if (report) usedFile = lcovPath;
    } catch {
      /* pas de lcov non plus */
    }
  }
  if (!report) return { available: false };
  report.files!.sort((a, b) => a.file.localeCompare(b.file));
  try {
    report.generated = usedFile
      ? (await stat(usedFile)).mtime.toISOString()
      : null;
  } catch {
    report.generated = null;
  }
  return report;
}

/** Descripteur du pseudo-module `core` pour la carte/détail Studio. */
export interface CoreInfo {
  path: string;
  name: string;
  version: string | null;
  dependencies: string[];
}

/**
 * Métadonnées du core pour Studio (carte + onglet Vue d'ensemble).
 *
 * `name` est forcé à `@nodefony/core` (cohérent avec `.ai/symbols.json` et le
 * frontmatter `module:`), même si son `package.json` se nomme `nodefony`.
 * `version`/`dependencies` viennent de ce `package.json`.
 */
export async function readCoreInfo(): Promise<CoreInfo> {
  const path = resolveCorePath();
  let version: string | null = null;
  let dependencies: string[] = [];
  try {
    const pkg = JSON.parse(await readFile(join(path, "package.json"), "utf8"));
    version = typeof pkg.version === "string" ? pkg.version : null;
    dependencies = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
    ];
  } catch {
    /* package.json illisible → valeurs par défaut */
  }
  return { path, name: CORE_PACKAGE, version, dependencies };
}
